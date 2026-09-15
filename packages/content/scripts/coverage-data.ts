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
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { type SpellDefinition } from '@ie/engine';
import { ADJUDICATED } from './missing-shapes.js';

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
  'circle-of-death',
  'compulsion',
  'cone-of-cold',
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
  'fireball',
  'flame-blade',
  'flame-strike',
  'grease',
  'greater-invisibility',
  'guidance',
  'guiding-bolt',
  'harm',
  'healing-word',
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
      executed: own.filter((f) => f.automation === 'engine').length,
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
