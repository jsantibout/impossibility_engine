/**
 * `LEDGER.md`: what stands between the engine and a playable level 5.
 *
 * **`COVERAGE.md` answers "how much of the SRD is built". This answers "what
 * is left before a level 1–5 party can play", and they are not the same
 * question.** The first is a measurement over the whole book and the right
 * way to read a project's size; the second is the one `docs/ROADMAP.md` ranks
 * every batch by, and until now it lived in a snapshot taken by hand from
 * scripts under `node_modules/.audit/` — a directory that vanishes on an
 * `npm ci`. The number the whole plan is aimed at could not be recomputed by
 * a second person, which is the failure this file exists to end.
 *
 * Five populations — the three the roadmap's §0 table names, and the two gate
 * G1 found had none:
 *
 * | | Restricted to |
 * |---|---|
 * | Spells the engine does not resolve | a level 5 character of some class can cast it |
 * | Features the blocker map answers for | a character of level 1–5 holds it, feats included |
 * | Items the item map answers for | the SRD prints a price, so a party can buy it |
 * | The glossary's general rules | every one: a level 1 character reaches them all |
 * | Stat-block lines nothing applies | the block is CR ≤ 5 |
 *
 * **The reach rule is the report's, not a second one.** `reachOf` and
 * `withinReach` in `coverage-data.ts` are what `playableLevels` itself asks,
 * and the ledger asks them too rather than restating "a cantrip where the
 * table gives cantrips, a spell whose level it has a slot of". The audit's
 * throwaway script restated it, and a ledger that disagreed with the report
 * about a Cleric's reach would put a spell on a brief nobody can cast.
 * `ledger.test.ts` asserts the agreement class by class.
 *
 * **Nothing here decides what counts as executed.** A spell is executed when
 * `EXECUTED_SPELL_IDS` says so, partial when `PARTIAL_SPELLS` says so, in the
 * map's population when `ledgerFeatureIds` says so, and read when the parser
 * got structure out of the sentence. Every one of those is somebody else's
 * derivation and is imported rather than re-spelled.
 *
 * This module has one writer and it runs only when Node was asked to run this
 * file, exactly as `coverage.ts` does and for the same reason: a test imports
 * it for the measurement, and a script that writes while being imported turns
 * the suite into the generator of the file the gauntlet diffs.
 *
 * Run with `npm run ledger`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { SRD_CONTENT } from '@ie/content';
import { dryBuild, refuseStaleBuild } from './build-freshness.js';
import {
  ADJUDICATED,
  ITEM_BLOCKED_ON,
  TRACKED_ADJUDICATED,
  blockersOf,
  itemBlockersIn,
  trackedAdjudicationGaps,
  type ItemEntry,
  type TrackedDefinition,
} from './missing-shapes.js';
import {
  featureBlockersOf,
  ledgerFeatureIds,
} from './missing-feature-shapes.js';
import { GLOSSARY_RULES, type GlossaryRule } from './glossary-rules.js';
import {
  EXECUTED_SPELL_IDS,
  LEGENDARY_ECONOMY,
  MONSTER_LINE_SHAPES,
  PARTIAL_SPELLS,
  RIDER_HANDOVER_SHAPE,
  CAST_LINE_SHAPE,
  hasUnspentCastLine,
  REACTION_USE_SHAPE,
  hasHandedOverResponse,
  RIDER_SHAPE,
  SAVE_HANDOVER_SHAPE,
  TRACKED_IDS,
  UNEXECUTED_TRAIT_SHAPE,
  hasHandedOverRider,
  hasHandedOverSave,
  hasUnappliedRider,
  hasUnexecutedTrait,
  isHandoverTrait,
  isReadLine,
  spellsInReach,
  statBlockLines,
  type ParsedSpell,
  type StatBlockLine,
} from './coverage-data.js';

/**
 * The level the ledger measures, and the owner's definition of the
 * destination: "playable to level 5" means everything a level 1–5 character
 * can reach is executed by the engine.
 */
export const LEDGER_LEVEL = 5;

/** The Challenge Rating a level 5 party is pointed at, and below. */
export const LEDGER_MAX_CR = 5;

/** The four claims `COVERAGE.md` keeps apart, read here rather than restated. */
export type SpellStatus = 'executed' | 'executed-partial' | 'tracked' | 'no-definition';

/**
 * What one item of a population is actually waiting for — three claims, not two.
 *
 * Gate G1's second finding: *waits on none* conflated **nobody has read it**,
 * **it is expressible and nobody wrote it** and **it is handed over**, and only
 * the third is finished business. The first two are work somebody still has to
 * do, and printing them in the finished column is how a plan believes it is
 * nearer the end than it is.
 *
 * | | |
 * |---|---|
 * | `'shape'` | at least one clause names a shape the engine does not have |
 * | `'definition'` | nothing blocks it: either nobody has read it, or the kinds already say it and nobody wrote it |
 * | `'none'` | somebody read every sentence and every one left is the table's or the engine's |
 *
 * The point of the middle column, and the reason it is a column rather than a
 * different metric: **a measurement over adjudications must rise when somebody
 * reads the book.** It cannot do that while the unread state is displayed as
 * zero, and the 89 → 90 → 89 movement that prompted the gate was the
 * instrument working with nowhere to put the reading.
 */
export type LedgerWait = 'shape' | 'definition' | 'none';

export interface LedgerSpell {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly status: SpellStatus;
  /** The shapes its unfinished clauses name, deduplicated and sorted. */
  readonly shapes: readonly string[];
  readonly wait: LedgerWait;
}

export interface LedgerFeature {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  /** Which book it is printed in, so a reader knows whose brief it is. */
  readonly source: 'class' | 'subclass' | 'species' | 'background' | 'feat';
  readonly automation: string;
  readonly shapes: readonly string[];
  readonly wait: LedgerWait;
}

/** One item a level 1–5 party can obtain, and what stands behind it. */
export interface LedgerItem {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly shapes: readonly string[];
  readonly wait: LedgerWait;
}

export interface LedgerMonsterShape {
  readonly shape: string;
  /** Lines of CR ≤ 5 blocks this shape accounts for. */
  readonly lines: number;
  /** Blocks at least one of those lines belongs to. */
  readonly blocks: number;
  /** A few named blocks, so a brief can start somewhere. */
  readonly examples: readonly string[];
}

export interface LedgerResidueLine {
  readonly monster: string;
  readonly cr: number;
  readonly section: string;
  readonly line: string;
}

export interface LedgerMonsters {
  /** CR ≤ 5 stat blocks the catalogue carries. */
  readonly blocks: number;
  readonly printed: number;
  readonly read: number;
  /** Printed lines the parser got nothing out of. */
  readonly handedOver: number;
  /** Read attack lines whose printed rider nothing applies. */
  readonly riders: number;
  /** Read trait lines whose mechanic no engine reader asks for. */
  readonly inertTraits: number;
  /**
   * Read trait lines the engine hands to the table and will never build.
   *
   * **Not part of {@link items}**, and that is the whole reason it is counted
   * separately: a handover waits on nothing, so putting it in the population
   * would inflate the map with entries blocked on nothing — and leaving it out
   * of the report entirely would hide a dozen printed sentences in the gap
   * between "spent" and "unspent". See `HANDOVER_TRAIT_KINDS` for the per-kind
   * reason.
   */
  readonly handedOverTraits: number;
  /**
   * The population: handed-over lines, plus the two families the parser read
   * and the engine does not spend.
   */
  readonly items: number;
  /** Blocks carrying none of them. */
  readonly clean: number;
  readonly unfinished: number;
  readonly shapes: readonly LedgerMonsterShape[];
  /** Handed-over lines matching no enumerated shape. */
  readonly residue: readonly LedgerResidueLine[];
}

export interface Ledger {
  readonly level: number;
  readonly spells: readonly LedgerSpell[];
  readonly features: readonly LedgerFeature[];
  readonly items: readonly LedgerItem[];
  /** The glossary's general rules — see `glossary-rules.ts`. */
  readonly rules: readonly GlossaryRule[];
  readonly monsters: LedgerMonsters;
}

/** One row of the summary table: a population, split by what it waits on. */
export interface LedgerRow {
  readonly name: string;
  /** The population's size in its own unit. */
  readonly size: number;
  readonly unit: string;
  /** Of {@link split}, what names at least one shape. */
  readonly blocked: number;
  /**
   * Of {@link split}, what waits on a **definition** — see {@link LedgerWait}.
   *
   * Zero on two of the three rows and that is a fact about the populations
   * rather than a placeholder: a feature is written or it is not, and a
   * stat-block line is parsed or it is not, so neither has an unread state to
   * report. The spells do, and it was being printed as finished business.
   */
  readonly pending: number;
  /**
   * Read to the end and handed over whole — **counted apart from
   * {@link size}**, which is P3-S6's ruling and the reason this is a fourth
   * field rather than a fourth reading of the third.
   *
   * {@link LedgerWait}'s `'none'` says "somebody read every sentence and every
   * one left is the table's or the engine's", which is finished business by
   * the ledger's own words — and while such an item counted in the size, the
   * road to zero ran through spells nobody may ever build. The bestiary's row
   * had already drawn this line for a trait the engine hands over: "a handover
   * waits on nothing, so putting it in the population would inflate the map
   * with entries blocked on nothing". This is the same line drawn for a spell.
   *
   * **Nothing is hidden by it.** The entries are listed by name under a
   * heading of their own in §1, because an entry silently missing from a
   * ledger looks exactly like an entry nobody read — which is the sentence
   * this whole report's header already makes about the column it replaced.
   *
   * Zero on four of the five rows, and that is a fact about those populations
   * rather than a placeholder, exactly as {@link pending} is: a feature, an
   * item, a glossary rule and a stat block are each built or not built, and
   * none of them carries a reading that says *this one is finished and nobody
   * may build it*. The bestiary counts its own handed-over traits in
   * {@link LedgerMonsters.handedOverTraits}, which is that population's answer
   * to the same question and is already outside its size.
   */
  readonly handedOver: number;
  readonly free: number;
  /**
   * The size in {@link splitUnit}, which is always `blocked + pending + free`.
   *
   * It differs from {@link size} on exactly one row. The bestiary's
   * population is *lines* and the question "does this wait on anything" is
   * only answerable per **block** — a block with four unapplied lines is one
   * fight that does not run, not four — so the two are different units and
   * the table prints both rather than dividing one by the other.
   */
  readonly split: number;
  readonly splitUnit: string;
}

const sorted = (ids: Iterable<string>): readonly string[] => [...new Set(ids)].sort();

/** Which of the four states a spell is in, read off the report's own sets. */
export const spellStatusOf = (id: string, defined: ReadonlySet<string>): SpellStatus => {
  if (!defined.has(id)) return 'no-definition';
  if (EXECUTED_SPELL_IDS.has(id)) return PARTIAL.has(id) ? 'executed-partial' : 'executed';
  if (TRACKED_IDS.has(id)) return 'tracked';
  return 'no-definition';
};

const PARTIAL = new Set(PARTIAL_SPELLS);

/** The clauses somebody wrote about this spell, whichever map holds them. */
const clausesOf = (
  id: string,
  status: SpellStatus,
): readonly { readonly why: string }[] | undefined =>
  status === 'no-definition'
    ? undefined
    : status === 'executed-partial'
      ? ADJUDICATED[id]
      : TRACKED_ADJUDICATED[id];

/**
 * The shapes one spell's unfinished clauses name.
 *
 * Three populations and one answer, because a spell is adjudicated in
 * whichever of the three maps its state puts it in: `BLOCKED_ON` for a spell
 * with no definition, `ADJUDICATED` for an executed one with a clause left,
 * `TRACKED_ADJUDICATED` for one the engine casts and does not resolve.
 *
 * **Three values are not shapes and all three are dropped here.** `'table'` is
 * a handover, `'engine'` says the clause *is* executed, and `'expressible'` —
 * gate G1's widening — says the existing kinds already reach it and nobody
 * wrote the definition. The last is the one that had to be named: without this
 * line it would print as a heading in the report's shape table, which is the
 * failure the disposition that widened the field names by hand.
 */
export const spellShapesOf = (id: string, status: SpellStatus): readonly string[] => {
  if (status === 'no-definition') return [...blockersOf(id)];
  return sorted(
    (clausesOf(id, status) ?? [])
      .map((clause) => clause.why)
      .filter((why) => why !== 'table' && why !== 'engine' && why !== 'expressible'),
  );
};

/**
 * Which of the three things one spell is waiting for.
 *
 * A spell with no definition at all always waits on one, whatever its clauses
 * say: an entry naming only handovers records that somebody read the book, not
 * that the catalogue holds the spell. Otherwise the reading decides — no entry
 * is **unread**, an `'expressible'` clause is a definition nobody wrote, and
 * anything else left is the table's or the engine's and is finished business.
 */
export const spellWaitOf = (
  id: string,
  status: SpellStatus,
  shapes: readonly string[],
): LedgerWait => {
  if (shapes.length > 0) return 'shape';
  if (status === 'no-definition') return 'definition';
  const clauses = clausesOf(id, status);
  if (clauses === undefined) return 'definition';
  return clauses.some((clause) => clause.why === 'expressible') ? 'definition' : 'none';
};

/** The parsed SRD spell index, which is where reach is measured against. */
const parsedSpells = (): readonly ParsedSpell[] =>
  JSON.parse(readFileSync('packages/srd/src/generated/spells.json', 'utf8')) as ParsedSpell[];

/**
 * Every tracked definition a level 1–5 character can cast, with its debts.
 *
 * The population {@link trackedAdjudicationGaps} is asked of, restricted by
 * the report's own reach rule rather than by a second one.
 */
export const trackedInReach = (level: number = LEDGER_LEVEL): readonly TrackedDefinition[] =>
  spellsInReach(SRD_CONTENT.classes, parsedSpells(), level)
    .filter((one) => TRACKED_IDS.has(one.id))
    .map((one) => ({ id: one.id, unmodelled: SRD_CONTENT.spell(one.id)?.unmodelled ?? [] }));

/**
 * Tracked spells in reach that print a debt the map has no reading of.
 *
 * The gate G1 finding, as a query: thirty-four of the forty spells the report
 * filed under *waits on no shape* carried no {@link TRACKED_ADJUDICATED} entry
 * at all, so the report called them finished business while their own
 * definitions recorded debts.
 */
export const unreadTracked = (level: number = LEDGER_LEVEL): readonly string[] =>
  trackedAdjudicationGaps(trackedInReach(level)).unrecorded;

/**
 * Every feature a character of level 1–5 holds, with where it is printed.
 *
 * **Feats are one of the five books, and gate G1 is why.** This walked
 * classes, subclasses, species and backgrounds and never `SRD_CONTENT.feats`
 * — sixteen feats, nine of them a level 1–5 character can take, none of which
 * the ledger could see. It costs a row only for a feat the map answers for,
 * which is what makes the omission the dangerous kind: silent while the
 * catalogue happens to agree with it.
 *
 * A feat has no `level` of its own and no `automation`. Its **bracket** is
 * the level, which is exactly what `FeatDefinition.minimumLevel` holds — an
 * Origin feat and a Fighting Style print none and are taken at 1 — and
 * `automation` is reported as its category, because the flag a feature
 * declares does not exist over here and reporting a made-up one would be
 * worse than reporting what the book prints.
 */
const featuresHeld = (level: number): readonly LedgerFeature[] => {
  const population = new Set(ledgerFeatureIds());
  const books = [
    ['class', SRD_CONTENT.classes.flatMap((one) => one.features)],
    ['subclass', SRD_CONTENT.subclasses.flatMap((one) => one.features)],
    ['species', SRD_CONTENT.species.flatMap((one) => one.features)],
    ['background', SRD_CONTENT.backgrounds.flatMap((one) => one.features)],
  ] as const;

  const found = new Map<string, LedgerFeature>();
  const take = (
    one: { readonly id: string; readonly name: string },
    at: number,
    source: LedgerFeature['source'],
    automation: string,
  ) => {
    if (at > level) return;
    if (!population.has(one.id)) return;
    if (found.has(one.id)) return;
    const shapes = [...featureBlockersOf(one.id)];
    found.set(one.id, {
      id: one.id,
      name: one.name,
      level: at,
      source,
      automation,
      shapes,
      wait: shapes.length > 0 ? 'shape' : 'none',
    });
  };

  for (const [source, features] of books) {
    for (const feature of features) take(feature, feature.level, source, feature.automation);
  }
  for (const feat of SRD_CONTENT.feats) {
    take(feat, feat.minimumLevel ?? 1, 'feat', feat.category);
  }
  return [...found.values()].sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
};

/**
 * What a level 1–5 party can put its hands on without the DM handing it over.
 *
 * **The fourth population, and gate G1 found it had no row at all.**
 * `ITEM_BLOCKED_ON` and `itemCoverageGaps` had been measuring the item half of
 * the book for a while, and neither the ledger nor its reach rule knew about
 * them — so a debt on something a party can *buy* was invisible on the one
 * report the roadmap ranks by.
 *
 * **The reach rule is a price.** The SRD prints one for the equipment tables
 * and for exactly one magic item, the Potion of Healing at 50 GP; everything
 * else under "Magic Items A–Z" arrives because a DM put it in a hoard, which
 * is a decision no ledger can predict and no criterion can require. So
 * `costCp !== null` is the whole of the rule, and it is the catalogue's own
 * field rather than a second list to keep.
 *
 * Parameterised over both sides for {@link coverageGaps}' reason: the row is
 * empty today and a row that can only be computed over data it agrees with is
 * not a measurement, so the test drives it with a priced item the map blocks.
 */
export const itemsInReach = (
  items: readonly {
    readonly id: string;
    readonly name: string;
    readonly kind: string;
    readonly costCp: number | null;
  }[] = SRD_CONTENT.items,
  blockedOn: Readonly<Record<string, ItemEntry>> = ITEM_BLOCKED_ON,
): readonly LedgerItem[] =>
  items
    .filter((one) => one.costCp !== null)
    .map((one) => {
      const entry = blockedOn[one.id];
      const shapes = entry === undefined ? [] : [...itemBlockersIn(entry)];
      return {
        id: one.id,
        name: one.name,
        kind: one.kind,
        shapes,
        // An item has no unread state of its own: the entry either names a
        // shape or the catalogue holds the record, and `itemCoverageGaps`
        // owns the question of whether somebody read the untranscribed tail.
        wait: (shapes.length > 0 ? 'shape' : 'none') as LedgerWait,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

/** The section a line is printed under, which is what a reader looks it up by. */
const sectionsOf = (
  monster: (typeof SRD_CONTENT.monsters)[number],
): readonly (readonly [string, StatBlockLine])[] => [
  ...monster.traits.map((line) => ['trait', line] as const),
  ...monster.actions.map((line) => ['action', line] as const),
  ...monster.bonusActions.map((line) => ['bonus action', line] as const),
  ...monster.reactions.map((line) => ['reaction', line] as const),
  ...monster.legendaryActions.map((line) => ['legendary action', line] as const),
];

/**
 * The shapes that run over a line the parser **read**.
 *
 * Everything else asks about a sentence nothing got structure out of, and a
 * recharge on a line whose attack is parsed is an economy the engine already
 * spends rather than a debt. That gate is the difference between the whole
 * bestiary's table in `COVERAGE.md`, which counts a shape wherever it is
 * printed, and this one, which counts what is *unapplied*.
 *
 * **Read is not paid**, which is the whole reason there are two of them: a
 * rider parsed and unapplied and a trait kind nobody asks for are both lines
 * the parser understood and the engine does nothing with.
 */
const OVER_READ_LINES: ReadonlySet<string> = new Set([
  RIDER_SHAPE,
  UNEXECUTED_TRAIT_SHAPE,
  SAVE_HANDOVER_SHAPE,
  // A hit the engine reads three quarters of. It is on this list for the
  // reason the save's handover is: the line *is* read, so the gate below would
  // hide it, and it is not *paid*, because SRD Gibbering Mouther's Prone lands
  // and the sentence about its victim being absorbed does not. A residue
  // leaves the line unpaid, and `unpaid` below says so too.
  RIDER_HANDOVER_SHAPE,
  // A line that casts, which is the newest of them and the same argument
  // again: the parser reads the ability, the printed DC and the menu, and
  // nothing spends one — so the gate below would hide a debt that the shape's
  // own note says is still owed.
  CAST_LINE_SHAPE,
  // A Reaction whose response is another line of the same block. Read — the
  // trigger is a window the engine holds and the response is a name on the
  // sheet — and not paid, because the engine offers the Reaction and hands the
  // response over rather than performing it.
  REACTION_USE_SHAPE,
]);

/** Whether a shape accounts for a line. */
const accountsFor = (
  shape: string,
  matches: (line: StatBlockLine) => boolean,
  line: StatBlockLine,
): boolean =>
  OVER_READ_LINES.has(shape) ? matches(line) : !isReadLine(line) && matches(line);

const auditMonsters = (maxCr: number): LedgerMonsters => {
  const low = SRD_CONTENT.monsters.filter((monster) => monster.cr <= maxCr);

  let printed = 0;
  let read = 0;
  let riders = 0;
  let inertTraits = 0;
  let handedOverTraits = 0;
  let clean = 0;
  // A line is settled when the parser read it *and* the engine spends what it
  // read. The two `read but not spent` families are counted beside the
  // handed-over lines rather than inside `read`, so learning to recognise a
  // sentence can never retire a debt on its own.
  const unpaid = (line: StatBlockLine): boolean =>
    !isReadLine(line) ||
    hasUnappliedRider(line) ||
    hasHandedOverRider(line) ||
    hasUnexecutedTrait(line) ||
    hasHandedOverSave(line) ||
    hasUnspentCastLine(line) ||
    hasHandedOverResponse(line);
  for (const monster of low) {
    const lines = statBlockLines(monster);
    printed += lines.length;
    read += lines.filter(isReadLine).length;
    riders += lines.filter(hasUnappliedRider).length;
    inertTraits += lines.filter(hasUnexecutedTrait).length;
    // Read, given to the table, and finished — counted so the number is on the
    // record rather than silently absent from both of the columns above. See
    // `HANDOVER_TRAIT_KINDS`.
    handedOverTraits += lines.filter(isHandoverTrait).length;
    if (!lines.some(unpaid)) clean += 1;
  }

  const shapes: LedgerMonsterShape[] = [];
  for (const [shape, matches] of MONSTER_LINE_SHAPES) {
    let lines = 0;
    const blocks = new Set<string>();
    const examples: string[] = [];
    for (const monster of low) {
      const hits = statBlockLines(monster).filter((line) => accountsFor(shape, matches, line));
      if (hits.length === 0) continue;
      lines += hits.length;
      blocks.add(monster.name);
      if (examples.length < 6) examples.push(`${monster.name} (CR ${monster.cr}) / ${hits[0]!.name}`);
    }
    shapes.push({ shape, lines, blocks: blocks.size, examples });
  }
  // The legendary economy belongs to the block rather than to a line, so it
  // is counted as one shape over every legendary action a CR ≤ 5 block prints.
  const legendary = low.filter((monster) => monster.legendaryActions.length > 0);
  shapes.push({
    shape: LEGENDARY_ECONOMY,
    lines: legendary.reduce((sum, monster) => sum + monster.legendaryActions.length, 0),
    blocks: legendary.length,
    examples: legendary
      .slice(0, 6)
      .map((monster) => `${monster.name} (CR ${monster.cr}) / ${monster.legendaryActions[0]!.name}`),
  });
  shapes.sort((a, b) => b.lines - a.lines || b.blocks - a.blocks || a.shape.localeCompare(b.shape));

  // **The legendary economy is not one of these**, and excluding its lines
  // here would take them off the ledger entirely. `LEGENDARY_ECONOMY` is a
  // debt the *block* owes — an action economy nothing spends — and what a
  // legendary line then *does* is a second debt that no line predicate
  // reaches. A Unicorn's Shimmering Shield is both, so it is counted in both,
  // exactly as a line that forces a save and recharges is.
  const named = (line: StatBlockLine): boolean =>
    MONSTER_LINE_SHAPES.some(([shape, matches]) => accountsFor(shape, matches, line));

  const residue: LedgerResidueLine[] = [];
  for (const monster of low) {
    for (const [section, line] of sectionsOf(monster)) {
      if (isReadLine(line)) continue;
      if (named(line)) continue;
      residue.push({ monster: monster.name, cr: monster.cr, section, line: line.name });
    }
  }
  residue.sort((a, b) => a.monster.localeCompare(b.monster) || a.line.localeCompare(b.line));

  const handedOver = printed - read;
  return {
    blocks: low.length,
    printed,
    read,
    handedOver,
    riders,
    inertTraits,
    handedOverTraits,
    items: handedOver + riders + inertTraits,
    clean,
    unfinished: low.length - clean,
    shapes,
    residue,
  };
};

/** The three populations, measured against the catalogue as it stands. */
export function auditLedger(level: number = LEDGER_LEVEL): Ledger {
  const parsed = JSON.parse(
    readFileSync('packages/srd/src/generated/spells.json', 'utf8'),
  ) as ParsedSpell[];
  const defined = new Set(
    // The definitions the catalogue holds, which is what tells a tracked
    // spell from one nothing has written at all.
    [...EXECUTED_SPELL_IDS, ...TRACKED_IDS],
  );

  const spells: LedgerSpell[] = [];
  for (const one of spellsInReach(SRD_CONTENT.classes, parsed, level)) {
    const status = spellStatusOf(one.id, defined);
    if (status === 'executed') continue;
    const shapes = spellShapesOf(one.id, status);
    spells.push({
      id: one.id,
      name: one.name,
      level: one.level,
      status,
      shapes,
      wait: spellWaitOf(one.id, status, shapes),
    });
  }

  return {
    level,
    spells,
    features: featuresHeld(level),
    items: itemsInReach(),
    rules: GLOSSARY_RULES,
    monsters: auditMonsters(LEDGER_MAX_CR),
  };
}

/**
 * The summary table: three populations, each split by what it waits on.
 *
 * **Three columns, not two**, which is gate G1's second finding. The middle
 * one is empty on two rows and that is a statement about those populations
 * rather than a placeholder — see {@link LedgerRow.pending}.
 *
 * **And a fourth, which is the spells row's size shrinking rather than a
 * column being added to it.** A spell read to the end and handed over whole is
 * finished business, so it leaves the population and is reported in
 * {@link LedgerRow.handedOver} — see that field for the argument and for why
 * it is zero everywhere else.
 */
export function ledgerTotals(ledger: Ledger): readonly LedgerRow[] {
  const split = (items: readonly { readonly wait: LedgerWait }[]) => ({
    blocked: items.filter((one) => one.wait === 'shape').length,
    pending: items.filter((one) => one.wait === 'definition').length,
    free: items.filter((one) => one.wait === 'none').length,
  });
  // The spells the row still owes. Everything else here splits its whole
  // population, because nothing else has a reading that finishes an item.
  const owed = ledger.spells.filter((one) => one.wait !== 'none');
  const spells = split(owed);
  const features = split(ledger.features);
  const items = split(ledger.items);

  return [
    {
      name: 'Spells in reach, not executed',
      size: owed.length,
      unit: 'spells',
      ...spells,
      handedOver: ledger.spells.length - owed.length,
      split: owed.length,
      splitUnit: 'spells',
    },
    {
      name: 'Features manual, or a pool with nothing to buy',
      size: ledger.features.length,
      unit: 'features',
      ...features,
      handedOver: 0,
      split: ledger.features.length,
      splitUnit: 'features',
    },
    {
      name: 'Items a level 1–5 party can buy',
      size: ledger.items.length,
      unit: 'items',
      ...items,
      handedOver: 0,
      split: ledger.items.length,
      splitUnit: 'items',
    },
    {
      name: 'Glossary general rules nothing executes',
      size: ledger.rules.length,
      unit: 'rules',
      blocked: ledger.rules.filter((one) => one.built === null).length,
      // A glossary rule is built or it is not: there is no definition waiting
      // to be written, because the rule is the book's and not the
      // catalogue's.
      pending: 0,
      handedOver: 0,
      free: ledger.rules.filter((one) => one.built !== null).length,
      split: ledger.rules.length,
      splitUnit: 'rules',
    },
    {
      name: 'CR ≤ 5 stat-block items handed over or unapplied',
      size: ledger.monsters.items,
      unit: 'items',
      blocked: ledger.monsters.unfinished,
      // A parsed line is read or it is handed over, and a block carrying one
      // handed-over line is unfinished. There is no third state to report.
      pending: 0,
      // The bestiary's own handed-over count is not this column: it is a count
      // of **lines** and this row splits **blocks**, so putting it here would
      // be the only cell in the table measured in the other unit. It is
      // reported in §5, out of `items` for the same reason this is out of the
      // spells row's size.
      handedOver: 0,
      free: ledger.monsters.clean,
      split: ledger.monsters.blocks,
      splitUnit: 'blocks',
    },
  ];
}

const HEADER = [
  '# LEDGER.md — what is left before a level 5 party can play',
  '',
  '> **Derived. Do not edit by hand.** Regenerate with `npm run ledger` and',
  '> commit the result. `COVERAGE.md` answers how much of the SRD is built;',
  '> this answers what stands between the engine and the destination in',
  '> `docs/ROADMAP.md` §0, which is the first of the four ship criteria:',
  '> **this report at zero**.',
  '',
  'Everything below is restricted to what a character of level 1–5 can reach.',
  'A spell is in reach when its class table gives a slot of its level at the',
  'fifth, or gives cantrips at all — the rule `playableLevels` applies, asked',
  'through the same two functions so the two cannot drift. A feature is in',
  'reach when it is printed at level 5 or below. A stat block is in reach when',
  'its Challenge Rating is 5 or less.',
  '',
  '**Waiting on a shape is a debt; waiting on nothing is not.** A clause the',
  'table owns is fiction no rule reads afterwards and nobody will ever pay it,',
  'which `docs/design/content.md` states as the test: a table fact that a rule',
  'then reads is a debt, a table fact nothing reads afterwards is a handover.',
  'An item in the *waits on none* column is finished business, and it is listed',
  'rather than omitted because an entry silently missing from a ledger looks',
  'exactly like an entry nobody read.',
  '',
  '**And there is a third column, because that last sentence used to be false.**',
  'Gate G1 found *waits on none* holding three different claims — nobody has',
  'read it, it is expressible and nobody wrote the definition, and it is handed',
  'over — of which only the third is finished. *Waits on a definition* is the',
  'first two. The point of splitting them out: a measurement over adjudications',
  'has to **rise** when somebody reads the book, and it cannot while the unread',
  'state is displayed as zero.',
  '',
  '**And a fourth, which takes items out of a size rather than out of a**',
  '**column.** A spell that has been read to the end and handed over whole is',
  'finished: every sentence it prints is the table’s or the engine’s, nobody',
  'will ever build it, and counting it in the size of the population the',
  'roadmap ranks by put the road to zero through work nobody may do. So it',
  'leaves the size and is counted in the last column, and §1 lists every one of',
  'them by name — the bestiary’s row already counts a handed-over trait apart',
  'for exactly this reason.',
  '',
];

const line = (row: LedgerRow): string => {
  const split =
    row.splitUnit === row.unit
      ? [`${row.blocked}`, `${row.pending}`, `${row.free}`]
      : [
          `on ${row.blocked} of ${row.split} ${row.splitUnit}`,
          `${row.pending}`,
          `${row.free} ${row.splitUnit} already clean`,
        ];
  return `| ${row.name} | ${row.size} ${row.unit} | ${split[0]} | ${split[1]} | ${split[2]} | ${row.handedOver} |`;
};

const spellLine = (one: LedgerSpell): string =>
  `- **${one.name}** (level ${one.level}) — ${one.status}`;

const featureLine = (one: LedgerFeature): string =>
  `- \`${one.id}\` — ${one.name} (level ${one.level}, ${one.source}, ${one.automation})`;

/**
 * How the *waits on nothing* tail of a population is headed and introduced.
 *
 * One population has an answer for it and the others do not, which is why this
 * is a parameter rather than a sentence in the renderer: a spell's clauses can
 * be read to the end and handed over whole, and a feature is built or it is
 * not. Absent is the plain heading every population had before.
 */
interface FreeSection {
  readonly heading: string;
  readonly note: readonly string[];
}

/** Everything of a population that waits on one shape, under that shape. */
function groupByShape<T extends { readonly shapes: readonly string[]; readonly wait: LedgerWait }>(
  items: readonly T[],
  render: (one: T) => string,
  noun: string,
  order: string,
  free?: FreeSection,
): readonly string[] {
  const shapes = sorted(items.flatMap((one) => one.shapes));
  const rows = shapes
    .map((shape) => {
      const blocks = items.filter((one) => one.shapes.includes(shape));
      return { shape, blocks, finishes: blocks.filter((one) => one.shapes.length === 1) };
    })
    .sort(
      (a, b) =>
        b.finishes.length - a.finishes.length ||
        b.blocks.length - a.blocks.length ||
        a.shape.localeCompare(b.shape),
    );

  const lines = ['', '| Shape | Blocks | Finishes |', '|---|---|---|'];
  for (const row of rows) {
    lines.push(`| \`${row.shape}\` | ${row.blocks.length} | ${row.finishes.length} |`);
  }
  lines.push(
    '',
    `**Blocks** is every ${noun} of this population the shape touches;`,
    '**finishes** is what it is the *only* blocker for — the column a tranche',
    `is planned from. A ${noun} can need more than one shape, so neither column`,
    'sums to the population.',
    '',
  );
  for (const row of rows) {
    lines.push(
      `#### \`${row.shape}\` — blocks ${row.blocks.length}, finishes ${row.finishes.length}`,
      '',
    );
    for (const one of row.blocks) {
      const rest = one.shapes.filter((shape) => shape !== row.shape);
      const also = rest.length === 0 ? '' : ` — also waits on ${rest.length}`;
      lines.push(`${render(one)}${also}`);
    }
    lines.push('');
  }

  const pending = items.filter((one) => one.wait === 'definition');
  lines.push(
    `#### Waiting on a definition — ${pending.length}`,
    '',
    'Nothing here is blocked. Each is either a paragraph nobody has recorded',
    'reading, or one the existing kinds already say and nobody has written — and',
    'both are work, which is why they are no longer printed as finished business.',
    '',
  );
  for (const one of pending) lines.push(render(one));

  const finished = items.filter((one) => one.wait === 'none');
  lines.push('', `#### ${free?.heading ?? 'Waiting on no shape'} — ${finished.length}`, '');
  if (free !== undefined) lines.push(...free.note, '');
  for (const one of finished) lines.push(render(one));
  lines.push('', `Listed by ${order}.`);
  return lines;
}

/** The whole report as text, measured but not written. */
export function renderLedger(ledger: Ledger = auditLedger()): string {
  const lines = [...HEADER];

  lines.push(
    '## The five populations',
    '',
    '| Ledger | Size | Waits on an engine shape | Waits on a definition | Waits on none | Read to the end, handed over whole |',
    '|---|---|---|---|---|---|',
  );
  for (const row of ledgerTotals(ledger)) lines.push(line(row));

  lines.push(
    '',
    '## 1. Spells in reach the engine does not resolve',
    '',
    'Four states, kept apart because conflating them is how a project believes',
    'it is finished. `executed-partial` is a spell the engine resolves that',
    'still carries a clause nobody has built; `tracked` is one it casts and',
    'hands the effect over; `no-definition` is a spell the catalogue does not',
    'hold at all. An executed spell with nothing left is not here.',
    '',
    '**The size above is what this population still owes, and a spell read to**',
    '**the end is not owed.** The last column counts the spells whose every',
    'printed sentence somebody has read and found to be the table’s or the',
    'engine’s: they are finished business by the definition of *waits on none*',
    'above, they will never be built, and while they counted in the size the',
    'road to zero ran through work nobody may do. The bestiary’s row had',
    'already drawn that line for a trait the engine hands to the table, and',
    'this is the same line drawn for a spell. They are **listed** below under a',
    'heading of their own, because a count subtracted with no list behind it is',
    'exactly the silently-missing entry this report’s header refuses.',
  );
  lines.push(
    ...groupByShape(ledger.spells, spellLine, 'spell', 'spell level, then name', {
      heading: 'Read to the end, handed over whole',
      note: [
        'Somebody read every printed sentence of each of these against the',
        'definition and the blocker map, and every clause left is the table’s to',
        'narrate or the engine’s to roll. **Nothing here is work.** It is out of',
        'the size above and is listed here so a reader can see what the table is',
        'being asked for — which is the whole of what these spells are.',
      ],
    }),
  );

  lines.push(
    '',
    '## 2. Features a level 1–5 character holds that the engine does not run',
    '',
    'The population is `missing-feature-shapes.ts`\'s: every feature declaring',
    '`automation: \'manual\'`, plus every feature declaring `engine` for a pool',
    'with nothing to spend a use on, plus the one pool whose uses buy some of',
    'what its page prints. Species and background traits are counted, because a',
    'species trait is the same `FeatureDefinition` a class feature is and a',
    'level 5 character holds one.',
    '',
    '**Feats are counted too, and until gate G1 they were in no population at**',
    '**all** — not this one, not the blocker map, not a guard. A `FeatDefinition`',
    'carries no `automation` flag to select on, so the arm that answers for them',
    'is `FEATS_ANSWERED_FOR`, a declared list held down at both ends by',
    '`pool-blockers.test.ts` exactly as `POOLS_ONLY_PARTLY_BOUGHT` is — the',
    'entries in it, and the complement pinned by name. Its bracket is the level:',
    'an Origin feat and a Fighting Style print none and are taken at 1, so nine',
    'of the sixteen are in a level 1–5 character\'s reach.',
  );
  const bySource = (source: string) =>
    ledger.features.filter((one) => one.source === source).length;
  lines.push(
    '',
    `Of the ${ledger.features.length}, ${bySource('class') + bySource('subclass')} are class or subclass features printed at level ${ledger.level} or below, ${bySource('species') + bySource('background')} are species or background traits and ${bySource('feat')} are feats.`,
    'The snapshot of 2026-09-21 in `docs/dev/roadmap-ledger-2026-09-21.md`',
    'counted the first group only, and did not see the pools; the traits are in',
    'reach of a level 5 character too, which is where the difference in the size',
    'comes from.',
  );
  lines.push(...groupByShape(ledger.features, featureLine, 'feature', 'level, then id'));

  const blockedItems = ledger.items.filter((one) => one.wait === 'shape');
  lines.push(
    '',
    '## 3. Items a level 1–5 party can buy',
    '',
    '**The reach rule is a price.** The SRD prints one for the equipment tables',
    'and for exactly one magic item — the Potion of Healing, at 50 GP — and',
    'everything else under *Magic Items A–Z* arrives because a DM put it in a',
    'hoard, which is a decision no ledger can predict and no ship criterion can',
    'require. So this row is what a party can walk into a shop and buy.',
    '',
    `Of the ${ledger.items.length}, ${blockedItems.length} wait on a shape the engine does not have.`,
    'The untranscribed tail of the magic-item book is a real population and it is',
    '`ITEM_BLOCKED_ON`\'s, measured by `itemCoverageGaps` and reported in',
    '`COVERAGE.md`; what it is not is something a level 5 party is owed, which is',
    'why the two reports count it in different places.',
    '',
  );
  for (const one of blockedItems) {
    lines.push(`- \`${one.id}\` — ${one.name} (${one.kind}) — ${one.shapes.join(', ')}`);
  }
  if (blockedItems.length === 0) {
    lines.push('*Nothing. Every priced item the catalogue holds carries a record.*');
  }

  const unbuilt = ledger.rules.filter((one) => one.built === null);
  lines.push(
    '',
    '## 4. The glossary’s general rules',
    '',
    'The population gate G1 found had **no home at all**: not a map, not a row,',
    'not a guard. Spells, features and items each have a blocker map because',
    'each is a record in the catalogue; a glossary rule is a heading in',
    '`packages/srd/raw/rules.md` that nothing parses, so this one is hand-listed',
    'in `packages/content/scripts/glossary-rules.ts` and held down at both ends',
    'by its own test — a row claiming to be built names something `@ie/engine`',
    'really exports or a `NAMED_ACTIONS` member, and a row claiming nothing runs',
    'it is quoted as a value in no engine source file: no switch arm, no union',
    'member, no lookup. Five of the seven are named in the engine’s prose and',
    'are still unbuilt, which is why the guard asks for a literal rather than',
    'for the word.',
    '',
    'These are the rules a level 1–5 character reaches whatever they are playing,',
    'so none of them waits on reach: every one is in it.',
    '',
  );
  for (const one of unbuilt) {
    lines.push(`- **${one.name}** (${one.kind}) — ${one.note}`);
  }

  const monsters = ledger.monsters;
  lines.push(
    '',
    '## 5. CR ≤ 5 stat-block lines handed over or unapplied',
    '',
    `${monsters.blocks} of the ${SRD_CONTENT.monsters.length} carried stat blocks are CR ≤ 5. They print ${monsters.printed} lines, of which the parser reads ${monsters.read} and hands over ${monsters.handedOver}. Reading is not spending: a further ${monsters.riders} of the read attack lines carry a printed rider nothing applies, and ${monsters.inertTraits} read trait lines state a mechanic no engine reader asks for. So the population is ${monsters.items} items over ${monsters.blocks} blocks — ${monsters.clean} of which already carry none of them.`,
    '',
    `**A third answer, counted apart from both:** ${monsters.handedOverTraits} of the read trait lines are sentences the engine reads and **hands to the table**, and will never execute — the breathing traits, the telepathies, the other planes, the substances this world holds none of, and the GM's own choices: sentences that say what a creature is and name nothing any rule consults. What is **not** among them is the other half of the residue below, where a sentence states a mechanic the engine has no seam for — an Amorphous squeezing through an inch, a Web Walker ignoring a web — because calling one of those fiction would retire a debt by renaming it. They are neither spent nor waiting, so they are not among the ${monsters.items} above and do not keep a block off the clean list. \`HANDOVER_TRAIT_KINDS\` holds the reason per kind, and \`coverage.test.ts\` pins that none of them has a reader after all.`,
    '',
    '**A block is the unit that matters and a line is the unit that is counted.**',
    'A block with four unapplied lines is one fight that does not run, not four,',
    'so the split above is per block while the size is per line. The piles below',
    'overlap: one sentence can force a save and recharge.',
    '',
    '| Shape | Lines | Blocks | Three example blocks |',
    '|---|---|---|---|',
  );
  for (const shape of monsters.shapes) {
    lines.push(
      `| ${shape.shape} | ${shape.lines} | ${shape.blocks} | ${shape.examples.slice(0, 3).join('; ') || '—'} |`,
    );
  }
  lines.push(
    '',
    '**Two of those rows are an effect nobody applies and an economy that is',
    'already correct.** A recharge and a per-day limit are parsed onto every',
    'line, carried onto the sheet, asked at the turn boundary and spent by',
    '`takeStatedAction`; what is unapplied on such a line is what it *does*.',
    'A brief quoting those rows should say so.',
    '',
    `### Handed-over lines matching no enumerated shape — ${monsters.residue.length}`,
    '',
    'A debt nobody has given an id to is still a debt, so these are named here',
    'rather than dropped. They carry no parsed structure at all, which is why no',
    'predicate reaches them and why classifying them is a reading of English',
    'rather than a derivation — the roadmap keeps that reading in prose, and the',
    'ledger keeps the list.',
    '',
    'A legendary action is in both this list and the economy row above, because',
    'they are two debts: that nothing spends a legendary action, and that',
    'nothing applies what the line says. Leaving it out of one would take half',
    'of it off the ledger.',
    '',
  );
  for (const one of monsters.residue) {
    lines.push(`- ${one.monster} (CR ${one.cr}) [${one.section}] ${one.line}`);
  }

  return `${lines.join('\n')}\n`;
}

/** True when Node was asked to run this file, rather than something importing it. */
const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMainModule) {
  // The same refusal `coverage.ts` takes and for the same reason: `tsx`
  // resolves `@ie/content` through `dist`, so a build behind its source would
  // measure yesterday's catalogue against today's maps.
  refuseStaleBuild(dryBuild());

  const ledger = auditLedger();
  writeFileSync('LEDGER.md', renderLedger(ledger), 'utf8');
  for (const row of ledgerTotals(ledger)) {
    console.log(
      `${row.name}: ${row.size} ${row.unit}, ${row.blocked} of ${row.split} ${row.splitUnit} waiting on a shape`,
    );
  }
}
