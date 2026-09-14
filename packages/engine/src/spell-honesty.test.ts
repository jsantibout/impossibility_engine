import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXECUTED_SPELL_IDS, PARTIAL_SPELLS } from '../scripts/coverage.js';
import {
  ADJUDICATED,
  MISSING_SHAPES,
  type Adjudication,
} from '../scripts/missing-shapes.js';
import { SPELL_DEFINITIONS } from './spell-definitions.js';

/**
 * The honesty guard, pointed at the spells the engine **executes**.
 *
 * `spell-tracking.test.ts` has held the line for the tracked bucket since it
 * existed: `unmodelled` means *this part of the spell belongs to the fiction,
 * and the engine should never decide it*, and it must never come to mean *the
 * engine ought to enforce this and nobody has built it yet*. That guard reads
 * each tracked spell's own **SRD paragraph** out of the parsed book, because a
 * tracked definition resolves nothing and every rule in its text is a claim.
 *
 * The executed bucket is the other half of the population and had no guard at
 * all — 58 of the 82 executed definitions carry `unmodelled` clauses and
 * nothing read one. The third whole-engine audit (2026-09-13, §3.5) found what
 * that costs: a frozen statue and a puff of dust are fiction, and beside them
 * sat "the target cannot regain Hit Points until the end of your next turn",
 * "the save has Advantage if you or your allies are fighting the target", a
 * Hit Point maximum reduction and three Difficult Terrain areas — every one a
 * rule the engine owns or has already named as a missing shape, filed as
 * though it were narration.
 *
 * **The text scanned is the clause, not the paragraph**, and that is the one
 * real difference from the tracked guard. An executed spell's paragraph is
 * mostly *executed*: scanning it would demand an adjudication for the very
 * dice the engine rolls. What is a claim is the sentence the definition wrote
 * about itself, so that is what is read.
 *
 * | | |
 * |---|---|
 * | `'table'` | fiction; the engine's resolution path never arrives at it, and it should never decide it |
 * | a shape id | the path *does* arrive, would answer wrongly, and a named, enumerated shape is missing |
 *
 * And **partial is a consequence rather than a list**: a spell carrying a
 * shape adjudication is one the engine drives and does not finish, which is
 * exactly what `PARTIAL_SPELLS` claims. The list in `coverage.ts` is asserted
 * against the derived set in both directions, so the report cannot drift from
 * the debts.
 */

/**
 * Every executed definition, read off the catalogue rather than listed — and
 * read through the **one** predicate that decides it.
 *
 * `isExecuted` lives in `coverage.ts` because the report counts with it, and
 * it is imported here rather than restated because this guard's entire
 * population is that predicate: a copy that drifted by forgetting
 * `areaTrigger` would quietly stop covering Web, Grease and Insect Plague and
 * nothing would go red. One of the three copies that existed had already lost
 * that arm.
 */
const EXECUTED: readonly string[] = [...EXECUTED_SPELL_IDS].sort();

/** The SRD condition names, which a clause names directly far more often than it says "condition". */
const CONDITIONS =
  'Blinded|Charmed|Deafened|Exhaustion|Frightened|Grappled|Incapacitated|Invisible|Paralyzed|Petrified|Poisoned|Prone|Restrained|Stunned|Unconscious';

/**
 * The mechanics the engine demonstrably owns, as patterns over a clause.
 *
 * Wider than the tracked guard's thirteen, and deliberately: that one reads
 * the book's careful prose, this one reads a sentence somebody here wrote
 * about a gap, and a gap is described in whatever words fit. "The save has
 * Advantage if you or your allies are fighting the target" carries no
 * "Advantage on", and the audit names it as debt — so the pattern is the word
 * rather than the book's phrase.
 *
 * Every entry names something the engine resolves today: the generator and
 * typed damage, vitals, `rollSavingThrow` and `rollAbilityCheck`,
 * `resolveAttack`, `armorClassOf`, `applyConditionTo`, `defensesOf`,
 * `combineRollModes`, Speed and the movement budget, declared Difficult
 * Terrain, forced movement, positions, the action economy and `mayAct`,
 * `mustBeType`, the ruler, declared sight, resource pools, Concentration,
 * `releaseCasting`, death, and what a creature owns and wears. A clause naming
 * none of them is left alone, and nineteen are: light, obscurement, a strong
 * wind, what a weapon looks like, whether a suggestion sounds achievable.
 */
const CLAUSE_MARKERS = [
  ['dice', /\b\d+d\d+\b/],
  ['damage', /\bdamage(d|s)?\b/i],
  ['hit-points', /\bHit Points?\b/],
  ['saving-throw', /\bsav(e|es|ing throw)s?\b/i],
  ['ability-check', /\bcheck\b/i],
  ['attack-roll', /\battack(s|ed|ing)?\b/i],
  ['armor-class', /\bArmou?r Class\b|\bAC\b/],
  ['condition', new RegExp(`\\bcondition\\b|\\b(${CONDITIONS})\\b`, 'i')],
  ['defence', /\b(Resistance|Immunity|Vulnerability|immune)\b/i],
  ['roll-mode', /\b(Advantage|Disadvantage)\b/],
  ['speed', /\bSpeed\b/],
  ['difficult-terrain', /\bDifficult Terrain\b/i],
  ['forced-movement', /\bpush(ed|es)?\b/i],
  ['teleport', /\bteleport/i],
  [
    'action-economy',
    /\b(Reaction|Bonus Action|Magic action|Study action|Opportunity Attacks?|Dash(es)?)\b/,
  ],
  [
    'creature-type',
    /\b(Aberration|Beast|Celestial|Construct|Dragon|Elemental|Fey|Fiend|Giant|Humanoid|Monstrosity|Ooze|Plant|Undead|Zombie)s?\b/,
  ],
  ['range', /\bwithin \d+ (feet|foot)\b|\breach\b|\brange\b/i],
  ['senses', /\b(see|sees|seen|sight|perceives|Blindsight|Truesight|hidden)\b/i],
  ['spell-slot', /\bslot\b/i],
  ['concentration', /\bConcentration\b/],
  ['movement', /\bmovement\b|\bmoves?\b|\bmoving\b/i],
  ['death', /\b(kill(ed|s)?|dies|died|dead)\b/i],
  ['dispel', /\bdispel/i],
  ['equipment', /\b(holding|carries|carrying|wearing|dons|equipped)\b/i],
] as const satisfies readonly (readonly [string, RegExp])[];

type MarkerId = (typeof CLAUSE_MARKERS)[number][0];

/**
 * The vocabulary, the executed population's adjudications, and the guards.
 *
 * **The data moved and the guards did not.** `MISSING_SHAPES` and
 * `ADJUDICATED` now live in `scripts/missing-shapes.ts` beside the same
 * vocabulary's other two populations, because a shape's consumer count has to
 * be countable over all three and `npm run coverage` runs outside vitest —
 * the same reason `PARTIAL_SPELLS` has always lived in `coverage.ts`. Every
 * assertion over the executed map is still here.
 *
 * **The list is no longer this bucket's own**, and the docstring that used to
 * apologise for repeating `speed-and-movement-modes` is obsolete: one
 * vocabulary serves the executed, tracked and undefined populations, and the
 * "no shape sits unclaimed" guard moved to `blocked-on.test.ts`, where it can
 * ask all three at once. Keeping it here would have deleted every shape only
 * an undefined spell is blocked on.
 */

/**
 * The SRD's own prose for every spell, read off disk.
 *
 * The same reader `spell-tracking.test.ts` and `coverage.test.ts` use, for the
 * same reason: `SPELL_INDEX` carries a spell's id, level, school and class list
 * and deliberately not its description, because the engine is pure and cannot
 * read a file at runtime. A test can, and what is being checked is the book.
 */
const PROSE: ReadonlyMap<string, string> = new Map(
  (
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../srd/src/generated/spells.json', import.meta.url)),
        'utf8',
      ),
    ) as readonly { id: string; description: string; higherLevel?: string }[]
  ).map((spell) => [spell.id, `${spell.description}\n${spell.higherLevel ?? ''}`]),
);

/** The mechanics this clause names. */
const markersIn = (clause: string): readonly MarkerId[] =>
  CLAUSE_MARKERS.filter(([, pattern]) => pattern.test(clause)).map(([marker]) => marker);

const clausesOf = (spellId: string): readonly string[] =>
  SPELL_DEFINITIONS.find((d) => d.id === spellId)?.unmodelled ?? [];

/** The clauses of this spell that name a mechanic the engine owns. */
const mechanicalClausesOf = (spellId: string): readonly string[] =>
  clausesOf(spellId).filter((clause) => markersIn(clause).length > 0);

const entriesFor = (spellId: string): readonly Adjudication[] => ADJUDICATED[spellId] ?? [];

const matching = (entry: Adjudication, clauses: readonly string[]): readonly string[] =>
  clauses.filter((clause) => clause.includes(entry.clause));

describe('an executed spell may not file a rule the engine owns as fiction', () => {
  it('has markers that actually fire, so the rule below is not vacuous', () => {
    // The clauses the audit read as debt, each firing on the mechanic it names.
    expect(markersIn('the target cannot regain Hit Points until the end of your next turn')).toContain(
      'hit-points',
    );
    expect(markersIn('the save has Advantage if you or your allies are fighting the target')).toContain(
      'roll-mode',
    );
    expect(markersIn('the Hit Point maximum reduction equal to the damage taken')).toContain(
      'hit-points',
    );
    expect(
      markersIn('the next attack roll against the target before the end of your next turn has Advantage'),
    ).toContain('attack-roll');
    expect(markersIn('the area is Difficult Terrain for the duration')).toContain(
      'difficult-terrain',
    );
    expect(markersIn('an attacker that perceives the target with Blindsight or Truesight')).toContain(
      'senses',
    );
  });

  /**
   * And the other direction, which is what keeps the marker list from becoming
   * a demand that every sentence be justified: a clause naming nothing the
   * engine owns is left alone.
   */
  it('leaves the fiction alone', () => {
    expect(markersIn('the mote of radiance that sheds sunlight for the duration')).toEqual([]);
    expect(
      markersIn('what the force looks like — "a weapon of your choice" — is narration'),
    ).toEqual([]);
    const quiet = EXECUTED.flatMap((id) =>
      clausesOf(id).filter((clause) => markersIn(clause).length === 0),
    );
    expect(quiet.length).toBeGreaterThan(10);
  });

  it.each(EXECUTED.map((s) => [s] as const))(
    'has a written adjudication for every mechanical clause in %s',
    (spellId) => {
      const entries = entriesFor(spellId);
      for (const clause of mechanicalClausesOf(spellId)) {
        const written = entries.filter((entry) => clause.includes(entry.clause));
        expect(
          written.length,
          `${spellId}: no adjudication for a clause naming ${markersIn(clause).join(', ')} — "${clause}"`,
        ).toBe(1);
      }
    },
  );

  /**
   * A stale exemption is the same failure wearing the other face: a clause
   * that once said something mechanical, no longer does, and keeps a licence
   * for it. An entry must match exactly one clause, and that clause must still
   * be one that names a mechanic.
   */
  it('carries no adjudication for a clause that is gone or is no longer mechanical', () => {
    for (const [spellId, entries] of Object.entries(ADJUDICATED)) {
      for (const entry of entries) {
        const hit = matching(entry, mechanicalClausesOf(spellId));
        expect(hit.length, `${spellId}: "${entry.clause}" matches ${hit.length} clauses`).toBe(1);
      }
    }
  });

  /** And every adjudicated spell is one the catalogue actually executes. */
  it('adjudicates only spells that are executed', () => {
    expect(Object.keys(ADJUDICATED).filter((id) => !EXECUTED.includes(id))).toEqual([]);
  });

  /** In an order two branches can both append to, like every other list here. */
  it('names them in an order two branches can both append to', () => {
    const ids = Object.keys(ADJUDICATED);
    expect(ids).toEqual([...ids].sort());
  });

  /**
   * The half that makes this more than a comment box: a clause that is not the
   * table's must name an enumerated missing shape, and adding one means adding
   * to a reviewed list that says where the repository already described it.
   */
  it('names an enumerated shape for every clause that is not the table’s', () => {
    for (const [spellId, entries] of Object.entries(ADJUDICATED)) {
      for (const entry of entries) {
        if (entry.why === 'table') continue;
        expect(Object.keys(MISSING_SHAPES), `${spellId}/${entry.clause}`).toContain(entry.why);
      }
    }
  });

  /** A note that says nothing is a licence, so each must be a real sentence. */
  it('writes a real sentence for every adjudication', () => {
    for (const [spellId, entries] of Object.entries(ADJUDICATED)) {
      for (const entry of entries) {
        expect(entry.note.length, `${spellId}/${entry.clause}`).toBeGreaterThan(60);
      }
    }
  });

  /**
   * "No shape sits unclaimed" is in `blocked-on.test.ts` now, over all three
   * populations at once — asking it here would delete every shape only an
   * undefined spell is blocked on, which is most of them. What stays here is
   * the half that is about *this* map: every shape an executed clause names is
   * one the vocabulary knows.
   */
  it('names no shape the vocabulary does not have', () => {
    const known = new Set<string>(Object.keys(MISSING_SHAPES));
    for (const [spellId, entries] of Object.entries(ADJUDICATED)) {
      for (const entry of entries) {
        if (entry.why === 'table') continue;
        expect(known.has(entry.why), `${spellId}/${entry.clause}`).toBe(true);
      }
    }
  });

  /**
   * A shape must say **where this repository already described the gap**, and
   * that has to be checkable rather than promised.
   *
   * The rule is the interesting half of the whole map: a shape invented in a
   * note is an architecture decision smuggled past review, and the only thing
   * standing between this list and that is whether each entry can point at
   * prose somebody already reviewed. A docstring saying so is the claim
   * `spell-tracking.test.ts` learned not to trust when it started asserting
   * `engine` in both directions. Four places count, and `spell-definitions.ts`
   * is one of them because a definition's own clause is where several of these
   * gaps were first written down.
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

  /**
   * The one adjudication that is true only while another spell is uncastable.
   *
   * Sunburst "dispels magical Darkness in the area", and ending a casting is an
   * operation the engine really has — `spell-ended`, and Dispel Magic through
   * it. What makes that clause the table's is not the rule but the population:
   * no Darkness definition compiles in, so there is no casting for it to reach.
   * That is exactly Counterspell's components qualifier, and that one is safe
   * because `counterspell.test.ts` pins the count that makes it so. This is the
   * same pin. The day Darkness gets a definition — tracked or executed — it
   * becomes an ongoing casting the engine can end, the clause becomes debt, and
   * this fails rather than going quietly on calling a rule fiction.
   */
  it('pins the fact that makes Sunburst’s dispel clause the table’s', () => {
    const dispelled = SPELL_DEFINITIONS.filter((d) => d.id === 'darkness');
    expect(
      dispelled,
      'Darkness now has a definition, so Sunburst dispelling it is a casting the engine could end',
    ).toEqual([]);
    expect(
      ADJUDICATED['sunburst']?.find((entry) => entry.clause === 'dispelling magical Darkness')?.why,
    ).toBe('table');
  });

  /**
   * And where a note quotes the book, it quotes the book.
   *
   * Found by review: four notes attributed to the SRD a sentence it does not
   * print — Dominate's repeat save, and Charm Person's Advantage clause wearing
   * Dominate's wording. That is the file's own subject failing inside the file,
   * and it is exactly the class of error `coverage.test.ts` already oracles for
   * a definition's printed fields. The quotation is checked against **this**
   * spell's paragraph, because a sentence some other spell prints is the way a
   * neighbouring clause gets lent to a spell that never had it.
   */
  it('quotes the SRD exactly, and quotes the right spell', () => {
    const normalise = (text: string) =>
      text
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/\s+/g, ' ')
        .trim();

    for (const [spellId, entries] of Object.entries(ADJUDICATED)) {
      const printed = normalise(PROSE.get(spellId) ?? '');
      expect(printed.length, `${spellId} is not in the parsed SRD`).toBeGreaterThan(0);
      for (const entry of entries) {
        if (!entry.note.includes('SRD')) continue;
        for (const quoted of entry.note.match(/"[^"]{8,}"/g) ?? []) {
          const fragment = normalise(quoted.slice(1, -1));
          expect(
            printed.includes(fragment),
            `${spellId} quotes "${fragment}", which its SRD paragraph does not print`,
          ).toBe(true);
        }
      }
    }
  });
});

/**
 * Partial is a consequence, not a list.
 *
 * A spell carrying a shape adjudication is one the engine drives and does not
 * finish, which is exactly what the third coverage state claims. Asserting the
 * hand list against the derived set in **both** directions is what stops the
 * report and the debts drifting apart: a clause newly adjudicated to a shape
 * fails the table until `PARTIAL_SPELLS` says so, and an entry that no longer
 * carries a debt fails until it is removed.
 *
 * The list stays in `coverage.ts` rather than being derived there, because
 * `npm run coverage` runs the script outside vitest and importing this file
 * would make the report generator depend on the test suite.
 */
describe('the partial set is derived from the debts', () => {
  const derived = Object.entries(ADJUDICATED)
    .filter(([, entries]) => entries.some((entry) => entry.why !== 'table'))
    .map(([spellId]) => spellId)
    .sort();

  it('has some, so the rule below is not vacuous', () => {
    expect(derived.length).toBeGreaterThan(0);
  });

  it('is exactly what the coverage script publishes', () => {
    expect([...PARTIAL_SPELLS].sort()).toEqual(derived);
  });

  /** Spirit Guardians was the hand list's only entry, and is still partial. */
  it('keeps the spell the third state was invented for', () => {
    expect(derived).toContain('spirit-guardians');
  });

  /** A spell whose every clause is the table's is finished, not partial. */
  it('leaves a spell whose clauses are all fiction out of it', () => {
    const allTable = Object.entries(ADJUDICATED)
      .filter(([, entries]) => entries.every((entry) => entry.why === 'table'))
      .map(([spellId]) => spellId);
    expect(derived.filter((id) => allTable.includes(id))).toEqual([]);
  });
});
