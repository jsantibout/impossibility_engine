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
import {
  adaptMonster,
  type ClassDefinition,
  type FeatureDefinition,
  type SpellDefinition,
  type SubclassDefinition,
} from '@ie/engine';
import { asCharacterId } from '@ie/shared';
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
  // Driven end to end by `executed-second-pass.test.ts`: the ten-minute rite
  // declared and settled, the 2d8 and its per-slot die measured over sixty
  // seeds by the gap between two means, and the Short Rest it does not confer
  // named in its own clause.
  'prayer-of-healing',
  'produce-flame',
  'protection-from-energy',
  'protection-from-poison',
  'ray-of-frost',
  'ray-of-sickness',
  // Driven end to end by `executed-second-pass.test.ts`: the minute on the
  // clock, the slot spent only when the rite finishes, 4d8 + 15 held to its
  // bounds and to its mean over sixty seeds, and the hit point a turn read
  // off the target's vitals after the turn was advanced rather than off the
  // dice — a payout the casting rolls nothing of would otherwise pass every
  // assertion in the file while being wrong.
  'regenerate',
  'sacred-flame',
  'shatter',
  // Driven end to end by `executed-second-pass.test.ts`: refused by the
  // ordinary casting command, then settled onto a held greatsword hit, with
  // the 2d6 Radiant and its per-slot die measured as the gap between two
  // populations of sixty swings rather than pair by pair — naming the smite
  // advances the generator, so the same seed no longer rolls the same sword.
  'shining-smite',
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

/** The levels a character has, which is what the class tables are twenty of. */
export const MAX_LEVEL = 20;

/** One class, followed through one of its subclasses: what a character is. */
export interface LevelPath {
  readonly classId: string;
  /** `Cleric (Life Domain)`, or the class alone where it has no subclass. */
  readonly name: string;
  readonly levels: readonly PathLevel[];
}

export interface PathLevel {
  readonly level: number;
  /** Features this path has been granted by this level, class and subclass. */
  readonly features: number;
  /** Of those, the ones the engine applies rather than records. */
  readonly executed: number;
  /** The highest spell level the class table gives a slot of here. */
  readonly highestSpellLevel: number;
  /** Spells the book prints on this class's list that the path can reach. */
  readonly reachable: number;
  /** Of those, the ones the engine casts and hands the effect to the DM. */
  readonly tracked: number;
  /** Of those, the ones whose effects the engine resolves. */
  readonly executedSpells: number;
}

/** The same six counts, added across every path a character could be on. */
export interface LevelRow {
  readonly level: number;
  readonly features: number;
  readonly executed: number;
  readonly reachable: number;
  readonly tracked: number;
  readonly executedSpells: number;
}

export interface PlayableCoverage {
  readonly rows: readonly LevelRow[];
  readonly paths: readonly LevelPath[];
}

/** What the derivation needs, so that a test can hand it something else. */
export interface PlayableInput {
  readonly classes: readonly ClassDefinition[];
  readonly subclasses: readonly SubclassDefinition[];
  readonly spells: readonly ParsedSpell[];
  readonly executed: ReadonlySet<string>;
  readonly tracked: ReadonlySet<string>;
}

/**
 * What a character of level N holds, and how much of it the engine runs.
 *
 * **Every other number in this file counts a population over the whole book.**
 * That is the right answer to "how much of the SRD is built" and the wrong one
 * to "can a level 5 party play", which is the question that actually gets
 * asked — and which has been answered by hand, in prose, twice. A hand answer
 * in a document is the thing rule 8 exists to forbid, so it is derived here
 * and printed as rows.
 *
 * Three things this report already knows are respected rather than restated:
 *
 * - **Parsed is not implemented**, so a level's spells are three counts and
 *   never one. *Reachable* is what the book prints on the class's list that
 *   the level can cast at all; *tracked* and *executed* are the two claims the
 *   sections above keep apart, read from the same two sets they are read from
 *   there. A row that added them would be the report's oldest mistake, one
 *   level down.
 * - **A feature arrives at a level.** `FeatureDefinition.level` is what the
 *   class table prints, so "what does a level 5 Barbarian have" is a filter
 *   and not an opinion, and `isExecutedFeature` — the predicate the class and
 *   origin tables already use — is what says how much of it runs.
 * - **A character is a class *and* a subclass**, so the unit here is a path
 *   rather than a class: a level 5 Cleric has the Life Domain's third-level
 *   features and not some average of the domains. One path per subclass, and a
 *   class with no subclass is one path of its own, which is a rule about
 *   shapes rather than a count of the twelve the SRD happens to print.
 *
 * **What it cannot see is whether a session can reach any of it**, which is
 * where the truth currently is: the engine executes things no tool can ask
 * for — a Cleric could turn undead a week before anything could be told to.
 * That axis is `@ie/tools`' to answer, and `@ie/tools` depends on
 * `@ie/content`, so a script in this package importing it would be a
 * dependency cycle and an inversion of the direction the packages are built
 * in. The alternative — a hand map from a grant kind to a tool name — is
 * exactly the prose classifier this file records the deletion of. So the
 * report measures the two axes it can and says plainly, in the section it
 * prints, which third one it is missing and where the measurement would have
 * to live.
 *
 * Taking its inputs rather than reading the catalogue is what lets the guard
 * drive it in both directions, the way `inconsistencies` is driven: a
 * catalogue where nothing is executed must report nothing executed, whatever
 * the book has printed.
 */
export function playableLevels(input: PlayableInput): PlayableCoverage {
  const paths: LevelPath[] = [];

  for (const definition of input.classes) {
    const mine = input.subclasses.filter((one) => one.classId === definition.id);
    // A spell is on a class's list when the book's own index says so, which is
    // the `classes` run `@ie/srd` parses off the spell's entry.
    const list = input.spells.filter((one) => one.classes.includes(definition.id));

    for (const subclass of mine.length === 0 ? [null] : mine) {
      const features = [...definition.features, ...(subclass?.features ?? [])];
      const levels: PathLevel[] = [];

      for (let level = 1; level <= MAX_LEVEL; level += 1) {
        const row = definition.table[level - 1];
        const slots = row?.spellSlots ?? [];
        // The highest slot the table gives, which is the last column with a
        // number in it rather than the width of the run: a Warlock's row reads
        // `[0, 0, 2]` at the fifth level and casts at the third.
        const highestSpellLevel = slots.reduce(
          (highest, count, index) => (count > 0 ? index + 1 : highest),
          0,
        );
        const cantrips = (row?.cantripsKnown ?? 0) > 0;
        const reachable = list.filter((one) =>
          one.level === 0 ? cantrips : one.level <= highestSpellLevel,
        );
        const held = features.filter((one) => one.level <= level);

        levels.push({
          level,
          features: held.length,
          executed: held.filter(isExecutedFeature).length,
          highestSpellLevel,
          reachable: reachable.length,
          tracked: reachable.filter((one) => input.tracked.has(one.id)).length,
          executedSpells: reachable.filter((one) => input.executed.has(one.id)).length,
        });
      }

      paths.push({
        classId: definition.id,
        name: subclass === null ? definition.name : `${definition.name} (${subclass.name})`,
        // **No casting style here**, though it is one property access away.
        // The Classes table already prints it, and the only thing this
        // measurement would use it for — which paths get a row in the spells
        // table — is answered by whether the path reaches a spell at any
        // level. A second rule for one question is the second place to get it
        // wrong, and a field nothing reads is where that starts.
        levels,
      });
    }
  }

  const rows = Array.from({ length: MAX_LEVEL }, (_unused, index) => {
    const at = paths.map((path) => path.levels[index]!);
    const total = (read: (one: PathLevel) => number) => at.reduce((sum, one) => sum + read(one), 0);
    return {
      level: index + 1,
      features: total((one) => one.features),
      executed: total((one) => one.executed),
      reachable: total((one) => one.reachable),
      tracked: total((one) => one.tracked),
      executedSpells: total((one) => one.executedSpells),
    };
  });

  return { rows, paths };
}

/** The same question, of the catalogue and the book as they stand. */
export function auditPlayableLevels(): PlayableCoverage {
  return playableLevels({
    classes: SRD_CONTENT.classes,
    subclasses: SRD_CONTENT.subclasses,
    spells: JSON.parse(
      readFileSync('packages/srd/src/generated/spells.json', 'utf8'),
    ) as ParsedSpell[],
    executed: EXECUTED_SPELL_IDS,
    tracked: TRACKED_IDS,
  });
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

export interface BestiaryCoverage {
  /** Stat blocks `@ie/srd` read out of the book. */
  readonly parsed: number;
  /** Blocks `SRD_CONTENT` holds, validated, reachable by id. */
  readonly carried: number;
  /** Entries in the printed vulnerability, resistance and immunity runs. */
  readonly defences: number;
  /** Of those, entries recognised and left to the DM because they are qualified. */
  readonly qualified: number;
  /** Of those, entries in neither vocabulary, kept verbatim and enforced by nobody. */
  readonly unread: number;
  /** Traits, actions, bonus actions, reactions and legendary actions, in total. */
  readonly printed: number;
  readonly rows: readonly {
    readonly kind: string;
    readonly printed: number;
  }[];
}

/**
 * The bestiary, counted for what it is rather than for what a reader would
 * like it to be.
 *
 * **Every parsed block is carried, and that is the whole of what the two big
 * columns claim.** There is no *tracked* and no *executed* here, because a
 * stat block has nothing to declare them with: `traits`, `actions`,
 * `bonusActions`, `reactions` and `legendaryActions` are `{ name, text }` —
 * the book's sentence, kept verbatim. A spell says what it does in a
 * vocabulary the engine executes and a feature declares its own automation, so
 * both can be read by a predicate; a monster's Multiattack is English, and a
 * predicate over English would be somebody's opinion wearing a derived
 * column's clothes. So the report counts the prose instead. *Printed* is the
 * size of what a stat block says and nothing here divides by it.
 *
 * **The defence columns are the adapter's answer, not a second reading of the
 * same strings.** `adaptMonster` is what the engine actually runs a stat block
 * through, and it sorts a printed defence run into three piles: the entries it
 * enforces, the entries it recognises but cannot evaluate — "Piercing (from
 * weapons wielded by creatures under a *Bless* spell)" — and the entries in
 * neither vocabulary. The last two are the only places a block loses anything,
 * and they are counted here by asking the adapter rather than by re-deriving
 * its rule.
 */
export function auditBestiary(): BestiaryCoverage {
  const parsed = JSON.parse(
    readFileSync('packages/srd/src/generated/monsters.json', 'utf8'),
  ) as readonly unknown[];

  const kinds = [
    ['Traits', 'traits'],
    ['Actions', 'actions'],
    ['Bonus actions', 'bonusActions'],
    ['Reactions', 'reactions'],
    ['Legendary actions', 'legendaryActions'],
  ] as const;

  const rows = kinds.map(([kind, field]) => ({
    kind,
    printed: SRD_CONTENT.monsters.reduce((sum, monster) => sum + monster[field].length, 0),
  }));

  let defences = 0;
  let qualified = 0;
  let unread = 0;
  for (const monster of SRD_CONTENT.monsters) {
    defences += monster.vulnerabilities.length + monster.resistances.length + monster.immunities.length;
    // The id is inert: nothing below reads it, and the adapter is asked here
    // only for how it sorted the defence run.
    const adapted = adaptMonster(monster, asCharacterId(monster.id));
    qualified += adapted.defenses.qualified.length;
    unread += adapted.caveats.length;
  }

  return {
    parsed: parsed.length,
    carried: SRD_CONTENT.monsters.length,
    defences,
    qualified,
    unread,
    printed: rows.reduce((sum, row) => sum + row.printed, 0),
    rows,
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
