/**
 * `COVERAGE.md`, rendered from the measurement in `coverage-data.ts`.
 *
 * **This module has one writer and it runs only when Node was asked to run
 * this file.** The write used to sit at module top level, and two test files
 * import the measurement — so `npm test` regenerated the report that the
 * gauntlet's `git diff --exit-code COVERAGE.md` then diffed, and that check
 * was asserting the suite had run rather than that the committed report was
 * right. Splitting the data out is what makes the guard sufficient: a test
 * that wants `PARTIAL_SPELLS` imports `coverage-data.ts` and never reaches
 * this file at all.
 *
 * The write sits **inside** the guard block rather than in a `main()` the
 * guard calls, because a function is callable from anywhere and a block is
 * not — which is the claim `coverage-script.test.ts` checks across the whole
 * of `scripts/`, driven over a synthetic write it has to catch.
 *
 * **Two things stop the run before the write, and both used to be neither.**
 * A build older than the source it would be measured from is refused, because
 * `tsx` resolves `@ie/content` through `dist` while the lists here are source
 * — the two can be a day apart. And a measurement that contradicts itself is
 * refused, where it used to be written into the file as a line of prose
 * beginning "**Inconsistent:**", which is a report describing its own
 * brokenness and shipping anyway. `coverage-script.test.ts` reads the order of
 * those two against the write off this file's own source.
 *
 * Run with `npm run coverage`.
 */

import { writeFileSync } from 'node:fs';
import { SPELL_DEFINITIONS } from '@ie/content';
import { pathToFileURL } from 'node:url';
import { dryBuild, refuseStaleBuild } from './build-freshness.js';
import {
  allItemShapeConsumers,
  allShapeConsumers,
  itemPiles,
  parsedItemIds,
  transcribedItemIds,
  TRACKED_ADJUDICATED,
} from './missing-shapes.js';
import {
  allFeatureShapeConsumers,
  featuresTheTableOwns,
} from './missing-feature-shapes.js';
import { magicItemEntries } from './magic-items.js';
import {
  auditBestiary,
  auditClasses,
  auditMagicItems,
  auditOrigins,
  auditPlayableLevels,
  auditSpells,
  coverageInconsistencies,
  PARTIAL_SPELLS,
  TRACKED_IDS,
  VERIFIED_SPELLS,
  type BestiaryCoverage,
  type ClassCoverage,
  type MagicItemCoverage,
  type OriginCoverage,
  type PlayableCoverage,
  type SpellCoverage,
} from './coverage-data.js';

function renderClasses(coverage: ClassCoverage): readonly string[] {
  const lines = [
    '',
    '## Classes',
    '',
    `| Classes | Subclasses | Features | Executed by the engine |`,
    `|---|---|---|---|`,
    `| ${coverage.classes} / 12 | ${coverage.subclasses} / 12 | ${coverage.features} | ${coverage.executed} |`,
    '',
    'A feature declares its own automation, so this column is read rather than',
    'guessed. **Manual is not failure**: several features are judgement the',
    'engine should never take from a DM, and every one of them carries a note',
    'saying what is left to do. But a project that does not count them will',
    'believe it has twelve working classes when it has twelve validated ones.',
    '',
    '| Class | Casting | Features | Executed |',
    '|---|---|---|---|',
  ];

  for (const row of [...coverage.rows].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`| ${row.name} | ${row.style} | ${row.features} | ${row.executed} |`);
  }

  lines.push(...renderFeatureBlockers());

  return lines;
}

/**
 * Why the rest of the features are manual, ranked rather than recalled.
 *
 * The table above says how many features the engine runs. This says what
 * stands in the way of the others, and it exists because that had no answer
 * anywhere: every manual feature has carried a note saying what is missing
 * since the day it was transcribed, and those notes — the best evidence in the
 * repository about where the next mechanic should go — were prose scattered
 * across twelve class files and `origins.ts`, read by nothing.
 *
 * **Blocks** is every manual feature a shape touches. **Finishes** is the ones
 * it is the *only* blocker for, which is the column a tranche is planned from,
 * and the two are different numbers for the same reason they are on the spells
 * and the items: reporting only one is how one family came to be ranked three
 * ways in three documents.
 *
 * It counts **features**, exactly as the column above does, and a feature may
 * need more than one shape — so the column does not sum to the manual total.
 * Species and background traits are in it: they are the same
 * `FeatureDefinition` and the same notes, and leaving them out would have
 * hidden a shape four of them share.
 */
function renderFeatureBlockers(): readonly string[] {
  const rows = allFeatureShapeConsumers();
  const lines = [
    '',
    '### What blocks the rest',
    '',
    'Derived from `packages/content/scripts/missing-feature-shapes.ts`, which',
    'holds the shapes only a feature wants plus the ones it shares with the',
    'spells and the magic items, and every manual feature read against its own',
    '`automation: \'manual\'` note. Species and background traits are counted',
    'here too, because a species trait is the same `FeatureDefinition` a class',
    'feature is and four of them turn out to want one shape.',
    '',
    '**Blocks** is every manual feature a shape touches. **Finishes** is the',
    'features it is the *only* blocker for — the ones building it would take off',
    'the list. Those are different numbers, and reporting only the first is how',
    'one family came to be ranked three ways in three documents.',
    '',
    'A shape from the spell or item vocabulary appears here whenever the gap is',
    'the same gap: Slow Fall waits on the missing `falling` Feather Fall waits',
    'on, a Dragon Companion on the summons Arcane Hand waits on, and Greater',
    'Divine Intervention on a spell nothing defines. Giving any of those a',
    'second id because the sentence this time is printed on a class table would',
    'be the second spelling of one derivation.',
    '',
    '| Shape | Blocks | Finishes |',
    '|---|---|---|',
  ];
  for (const row of rows) {
    lines.push(`| \`${row.shape}\` | ${row.blocks.length} | ${row.finishes.length} |`);
  }
  lines.push(
    '',
    'A feature can need more than one shape, so neither column sums to the',
    'manual total.',
    '',
    '**Some features are nobody’s work.** A Fighting Style is its feat’s debt,',
    'Thieves’ Cant and Druidic are languages, and Hunter’s Lore is knowledge —',
    'each is marked manual, each is finished business, and each is listed rather',
    'than omitted, because an entry silently missing from a ranking looks',
    'exactly like an entry nobody read:',
    '',
  );
  for (const id of featuresTheTableOwns()) lines.push(`- \`${id}\``);
  return lines;
}

/**
 * Species and backgrounds, counted with the class column's own predicate.
 *
 * **They were honest and uncounted at the same time.** Every trait the engine
 * cannot execute is marked `manual` and says what a DM is left holding — the
 * standard the class corpus set — and none of it appeared anywhere, because
 * the only audit there was audits classes.
 *
 * Its own section rather than rows in the table above, because that table's
 * totals answer "how much of a class does the engine run". A species has no
 * casting style and no subclasses; folding its traits into that total would
 * change what the existing numbers mean without changing their names.
 */
function renderOrigins(coverage: OriginCoverage): readonly string[] {
  const lines = [
    '',
    '## Origins',
    '',
    '| Species | Backgrounds | Features | Executed by the engine |',
    '|---|---|---|---|',
    `| ${coverage.species} | ${coverage.backgrounds} | ${coverage.features} | ${coverage.executed} |`,
    '',
    'A species trait and a class feature are the same `FeatureDefinition` and',
    'declare automation the same way, so this is the column above read by the',
    'same predicate — `isExecutedFeature` in',
    '`packages/content/scripts/coverage-data.ts`, which both tables call.',
    '**Manual is not failure** here either: what a species still grants',
    'manually is a Breath Weapon, a lineage’s spells or a Hit Point maximum',
    'that grows, and each carries a note saying exactly what is left to the',
    'table and why. Darkvision used to lead that list and no longer does — it',
    'is a `sense` grant now, on every species whose paragraph prints one, and',
    'the rows below are where that shows.',
    '',
    '**Feats are not counted.** A `FeatDefinition` declares no automation — it',
    'carries a note about what a DM still applies and nothing the engine reads —',
    'so there is no predicate to read one with, and a column claiming to be',
    'derived would be somebody’s opinion instead.',
    '',
    '| Origin | Kind | Features | Executed |',
    '|---|---|---|---|',
  ];

  for (const row of [...coverage.rows].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`| ${row.name} | ${row.kind} | ${row.features} | ${row.executed} |`);
  }

  return lines;
}

/**
 * Magic items, where the two populations must never be divided by each other.
 *
 * The SRD writes _Weapon, +1, +2, or +3_ **once**, as a template over the
 * weapon table, and the catalogue holds a +1, a +2 and a +3 of each weapon
 * because an inventory holds a sword rather than a template. Four entries
 * account for most of the catalogue's magic items. So "how much of the book is
 * transcribed" is a count of entries and "how many magic items are there" is a
 * count of records, and printing the second under the first would claim the
 * Weapons chapter was covered nearly four times over.
 */
function renderMagicItems(coverage: MagicItemCoverage): readonly string[] {
  const lines = [
    '',
    '## Magic items',
    '',
    'Five states, and *transcribed* and *instances* count different things and',
    'are never divided by each other:',
    '',
    '| | Means |',
    '|---|---|',
    '| **Parsed** | `@ie/srd` has the entry: name, category, rarity line, attunement bracket, charges, prose |',
    '| **Transcribed** | at least one catalogue record was read out of that entry |',
    '| **Instances** | the catalogue records those entries expand to |',
    '| **Complete** | a record that carries no `unmodelled` note: it does everything its entry says |',
    '| **Partial** | a record carrying at least one, quoting the clause it leaves to the table |',
    '',
    '**One entry is not one item.** The SRD writes _Weapon, +1, +2, or +3_ once,',
    'as a template over the weapon table; the catalogue holds a +1, a +2 and a +3',
    'of every weapon in it, because an inventory holds a sword rather than a',
    'template. A handful of template entries account for most of the records',
    'below, which is why *transcribed* counts entries and *instances* counts',
    'records. *Transcribed* against *parsed* is a fraction of the book and is',
    'meant to be read as one; *instances* against either is not a fraction of',
    'anything, and reading it as one would report the Weapons chapter as',
    'covered several times over — the Weapons row below says by how much, which',
    'is where a figure like that belongs.',
    '',
    `| Parsed | Transcribed | Instances | of which complete | of which partial |`,
    `|---|---|---|---|---|`,
    `| ${coverage.parsed} | ${coverage.transcribed} | ${coverage.instances} | ${coverage.complete} | ${coverage.partial} |`,
    '',
    'An entry with **no** record is one whose whole text is beyond the grant',
    'vocabulary. `packages/content/src/items.ts` states the three rules that',
    'decide it — and the third is the sharp one: an item is left out when the',
    'clause the engine cannot say is the one that *limits* the benefit, because',
    'a Cloak of Displacement without its "if you take damage" is a better cloak',
    'than the book prints.',
    '',
    '**Whether a test drives an item end to end is not counted here.** That is',
    'the spells table’s *verified*, and it is a hand-kept list precisely because',
    'no derivation can say it: the claim belongs to the commit that writes the',
    'test. There is no such list for items, so this says nothing rather than',
    'inventing a column that nothing checks.',
    '',
    '| Category | Parsed | Transcribed | Instances | Complete | Partial |',
    '|---|---|---|---|---|---|',
  ];

  for (const row of coverage.rows) {
    lines.push(
      `| ${row.category} | ${row.parsed} | ${row.transcribed} | ${row.instances} | ${row.complete} | ${row.partial} |`,
    );
  }

  lines.push(
    '',
    '### Entries transcribed',
    '',
    'Each is one entry of "Magic Items A–Z", with the records it expands to and',
    'how many of those still carry a clause the engine does not say.',
    '',
  );
  for (const entry of coverage.entries) {
    const gaps = entry.partial === 0 ? 'complete' : `${entry.partial} partial`;
    lines.push(`- **${entry.name}** (${entry.category}) — ${entry.instances} recorded, ${gaps}`);
  }

  lines.push(...renderItemBlockers(coverage));

  return lines;
}

/**
 * Why the rest of the book is not transcribed, counted rather than assumed.
 *
 * The section above says how many entries have a record. This one says why the
 * others do not, and it exists because that had no answer: the three rules at
 * the head of `packages/content/src/items.ts` say how an omission is *decided*
 * and the decision itself lived only in the absence of a record.
 *
 * **Five piles, and the only one a brief transcribes from is the expensive one
 * to land in.** *Ready* means somebody read the entry sentence by sentence —
 * every sentence tripping a mechanical marker carries a written clause — found
 * no clause needing a shape the engine lacks, and found at least one the grant
 * vocabulary can write down. Failing any of the three puts the entry in
 * *unread*, which is where an entry goes by default rather than by decision. A
 * false positive there costs a builder an afternoon and a false negative costs
 * the catalogue an item, so the classifier is arranged to fail towards
 * *unread*.
 *
 * *Fiction* is the fifth pile and it is not a lesser *ready*: rule 1 in
 * `items.ts` refuses a record that carries only notes, so an entry the engine
 * has nothing to record is finished business rather than pending work.
 *
 * **The piles count entries, like *transcribed* above and unlike *instances*.**
 * They are five parts of one number — every entry of "Magic Items A–Z" is in
 * exactly one — and none of them is ever divided by a count of records.
 */
function renderItemBlockers(coverage: MagicItemCoverage): readonly string[] {
  const piles = itemPiles(parsedItemIds(), transcribedItemIds());
  const rows = allItemShapeConsumers();
  const named = new Map(magicItemEntries().map((entry) => [entry.id, entry]));
  const lines = [
    '',
    '### What blocks the rest',
    '',
    'Derived from `packages/content/scripts/missing-shapes.ts`, which holds the',
    'same missing-shape vocabulary the spells are read against plus the shapes',
    'only an item has, and every untranscribed entry read against its own SRD',
    'entry. The question it answers is the one a batch turns on: how many of the',
    'entries with no record are **blocked** by a mechanic the engine lacks, and',
    'how many are simply not yet written.',
    '',
    'These count **entries**, exactly as *transcribed* above does, and every',
    'entry of "Magic Items A–Z" is in exactly one of them.',
    '',
    '| | Means |',
    '|---|---|',
    '| **Transcribed** | at least one catalogue record was read out of the entry |',
    '| **Blocked** | at least one clause needs a shape the engine does not have, named below |',
    '| **Ready** | read sentence by sentence; every clause is the table’s or expressible, and at least one is expressible |',
    '| **Fiction** | read the same way, and there is nothing for a record to carry — `items.ts` rule 1, not a gap |',
    '| **Unread** | nobody has read it, or nobody could name its blocker without inventing a shape |',
    '',
    '| Parsed | Transcribed | Blocked | Ready | Fiction | Unread |',
    '|---|---|---|---|---|---|',
    `| ${coverage.parsed} | ${piles.transcribed.length} | ${piles.blocked.length} | ${piles.ready.length} | ${piles.fiction.length} | ${piles.unread.length} |`,
    '',
    '**Unread is the honest default**, not a backlog nobody got to. An entry',
    'whose blocker cannot be named from something this repository has already',
    'written down says so in its own words rather than being sorted into either',
    'pile: naming a shape for it would be an architecture decision smuggled in',
    'as a note, and calling it the table’s would put an entry with nothing to',
    'record on the list below.',
    '',
    '#### Ready to transcribe',
    '',
    'Blocked by nothing. Each has been read sentence by sentence, and each has',
    'at least one clause the grant vocabulary can already say — which is the',
    'difference between this list and the fiction pile.',
    '',
  ];
  for (const id of piles.ready) {
    const entry = named.get(id);
    lines.push(
      `- **${entry?.name ?? id}** (${entry?.category ?? 'unknown'}) — every clause is the table’s or expressible`,
    );
  }
  lines.push(
    '',
    '#### The shapes that block the rest',
    '',
    '**Blocks** is every untranscribed entry a shape touches. **Finishes** is',
    'the entries it is the *only* blocker for — the ones building it would',
    'release — and it is split into *read* and *unread* for the reason the',
    'spells’ table splits it: an entry naming one blocker for a paragraph',
    'printing three passes every guard, so the first column is what a tranche',
    'may be planned from and the second is what it may be planned from once',
    'somebody reads it.',
    '',
    'Shapes from the spell vocabulary appear here too, and that is the point of',
    'there being one vocabulary: the heaviest blocker in the whole of "Magic',
    'Items A–Z" **was** a spell the catalogue could not execute, so a tranche',
    'aimed at wands would have bought nothing until the spells underneath them',
    'existed. A Belt of Giant Strength still waits on the same missing reader',
    'SRD Feeblemind does.',
    '',
    'That finding was then spent: the spells were written and the entries',
    'waiting on them alone came off. What is left of that shape is the half no',
    'amount of transcription reaches — a spell whose definition resolves',
    'nothing, which a potion confers as an empty effect list rather than',
    'casting. The table below says what is heaviest now; it is derived on',
    'every run, and a sentence here naming one would be a count in prose that',
    'the next tranche makes false.',
    '',
    '| Shape | Blocks | Finishes (read) | Finishes (unread) |',
    '|---|---|---|---|',
  );
  for (const row of rows) {
    lines.push(
      `| \`${row.shape}\` | ${row.blocks.length} | ${row.finishesRead.length} | ${row.finishesUnread.length} |`,
    );
  }
  lines.push(
    '',
    'An entry can need more than one shape, so the column does not sum to the',
    'blocked pile.',
  );
  return lines;
}

/**
 * What blocks the rest, counted rather than estimated.
 *
 * The repository carried **three** rankings of one family and they disagreed by
 * four times, because none of them was derived. `missing-shapes.ts` holds the
 * vocabulary and every spell blocked on it across all three populations, so
 * this table is a query.
 *
 * **Three columns, and each difference is a finding.** *Blocks* is every spell
 * a shape touches; *finishes* is the spells it is the only blocker for — the
 * ones building it would complete. A granted defence finishes exactly two and
 * touches several times that many, and reporting only the second number is how
 * 17, 4 and 2 came to be three answers to one question.
 *
 * And *finishes* is itself two numbers, because an entry that names one blocker
 * for a spell printing three used to pass every guard. IE-044 gave the
 * undefined map the clause-anchored entry type the executed one always had, so
 * a spell whose paragraph somebody has read sentence by sentence is now
 * distinguishable from one nobody has — and every wrong prediction this map has
 * made was an unread sentence rather than a wrong entry. No figure is written
 * down here: the table below prints all three, which is the whole point.
 */
/**
 * The bestiary's one count row, written once and read by the guard.
 *
 * `coverage.test.ts` asserts the committed report carries exactly this line,
 * which is only a check on the report being generated if both sides render it
 * the same way — a second spelling in the test would agree with itself while
 * the file said something else.
 */
export function bestiaryRow(coverage: BestiaryCoverage): string {
  return (
    `| ${coverage.parsed} | ${coverage.carried} | ${coverage.defences} | ` +
    `${coverage.qualified} | ${coverage.unread} | ${coverage.printed} |`
  );
}

/**
 * The bestiary, which has two columns that cannot move and one that can only
 * be honest about how much it is not.
 *
 * **There is no *executed* column and the absence is the finding.** A spell
 * declares its effects and a feature declares its automation, so a predicate
 * can read both; a stat block declares a name and a paragraph. Writing
 * `executed: 0` would be a derived-looking column whose derivation is a
 * constant, and writing nothing at all would leave the size of the gap in
 * prose — which is where it was. So the report counts the prose: every trait
 * and action the catalogue holds, by kind, none of which the engine reads.
 */
function renderBestiary(coverage: BestiaryCoverage): readonly string[] {
  const lines = [
    '',
    '## Bestiary',
    '',
    'Five states, and the last one is a count of what the engine does *not*',
    'read:',
    '',
    '| | Means |',
    '|---|---|',
    '| **Parsed** | `@ie/srd` has the stat block: size, type, Armour Class, Initiative, hit points, speeds, abilities with their saves, skills, the defence runs, senses, languages, CR and XP |',
    '| **Carried** | `SRD_CONTENT` holds that block and `checkContent` validated it, so `addCreature` puts the creature into a game by its id and every number in the event is the block’s |',
    '| **Qualified** | a printed defence the engine recognises and cannot evaluate — _Piercing (from weapons wielded by creatures under a Bless spell)_ — recorded and handed to the DM rather than enforced or dropped |',
    '| **Unread** | a defence entry in neither the damage nor the condition vocabulary, kept verbatim for the same reason |',
    '| **Printed lines** | the traits, actions, bonus actions, reactions and legendary actions the blocks print: a name and the book’s sentence each |',
    '',
    '| Parsed | Carried | Defence entries | of which qualified | of which unread | Printed lines |',
    '|---|---|---|---|---|---|',
    bestiaryRow(coverage),
    '',
    '**A stat block arrives as a body, not as an actor.** `adaptMonster`',
    'carries across everything the block states as a number — the printed',
    'Armour Class, the stated saves and skills, the average hit points, the',
    'speeds, the size and the creature type a spell like Hold Person reads — so',
    'an SRD monster can be placed, attacked, damaged, made to roll a save,',
    'targeted and killed, and the engine supplies every one of those numbers',
    'itself. What the creature *does* on its turn is not carried at all.',
    '',
    '**Printed lines is not a denominator**, and the difference between this',
    'and the tables above is the whole reason it is counted. A tracked spell',
    'has a definition that says what it leaves to the table; an untranscribed',
    'item is an entry somebody has read and classified. A printed line is',
    'neither: it is the SRD’s English, held as `{ name, text }`, with no attack',
    'bonus, damage die, save DC or recharge read out of it by anybody. So the',
    'column says how much prose the catalogue holds, and no fraction of it is',
    'claimed — a *tracked* or *executed* column here would be a predicate over',
    'English, which is an opinion in a derived column’s clothes.',
    '',
    '**A monster’s spellcasting is in that prose too**, which is why',
    '`declareSpellcasting` states it and nothing infers it: reading a caster’s',
    'ability and list out of a trait’s sentence would be the engine deciding a',
    'fact the book wrote for a person.',
    '',
    '| Line | Printed |',
    '|---|---|',
  ];

  for (const row of coverage.rows) lines.push(`| ${row.kind} | ${row.printed} |`);

  return lines;
}

/**
 * What a character of a level holds, and how much of it runs.
 *
 * **The question every other section answers sideways.** They count a
 * population over the whole book, which says how much of the SRD is built and
 * not whether a party can sit down and play. A level 5 Barbarian holds the
 * features printed at levels one to five; a level 5 Cleric can reach the
 * spells on the Cleric list up to the third, because the table gives them a
 * third-level slot and no fourth. Both are in the catalogue, both were
 * answered by hand twice, and a hand answer in a document is the thing rule 8
 * forbids.
 *
 * The three states the sections above keep apart are kept apart here, because
 * a row that added *tracked* to *executed* would be the report's oldest
 * mistake one level down. The unit is a **path** — a class followed through
 * one of its subclasses — because that is what a character is.
 *
 * `playableLevels` is the derivation and says what it cannot see; the sentence
 * below is where a reader meets it.
 */
function renderPlayableLevels(coverage: PlayableCoverage): readonly string[] {
  const levels = coverage.rows.map((row) => row.level);
  const lines = [
    '',
    '## What a character of a level can play',
    '',
    'Every table above counts a population over the whole book. This one asks',
    'the question a party asks — *can we play this level yet* — of the same',
    'catalogue and the same two predicates, and it adds nothing to them.',
    '',
    '| | Means |',
    '|---|---|',
    '| **Path** | a class followed through one of its subclasses, which is what a character is: a Cleric of the Life Domain has the Life Domain’s features and not an average of the domains |',
    '| **Held** | features the path has been granted by this level, class and subclass together, read off each feature’s own printed level |',
    '| **Executed** | of those, the ones `isExecutedFeature` says the engine applies rather than records — the column the Classes table uses |',
    '| **In reach** | spells the book prints on this class’s list that a character of this level can cast at all: a cantrip where the table grants cantrips, and a spell whose level the table has a slot of |',
    '| **Tracked**, **Executed** | of those in reach, the two claims the Spells table keeps apart, read from the same two sets |',
    '',
    '**In reach is a denominator, not an achievement.** It is what the book',
    'offers a character of this level, and the engine either resolves it, casts',
    'it and hands the effect to the DM, or has never heard of it. The three are',
    'never added.',
    '',
    '| Level | Held | Executed | In reach | Tracked | Executed |',
    '|---|---|---|---|---|---|',
  ];

  for (const row of coverage.rows) {
    lines.push(
      `| ${row.level} | ${row.features} | ${row.executed} | ${row.reachable} | ${row.tracked} | ${row.executedSpells} |`,
    );
  }

  lines.push(
    '',
    'The totals are every path added together, so a spell on two class lists is',
    'counted once for each path that can reach it — the row is the book at that',
    'level, not a party. A party is the rows below.',
    '',
    '**What this cannot see is whether a session can reach any of it**, and',
    'that is where the truth currently is: the engine executes things no tool',
    'can ask for. A Cleric could turn undead for a week before anything could',
    'be told to. The tool surface holds that answer and `@ie/tools` depends on',
    '`@ie/content`, so the script that writes this report cannot import it',
    'without inverting the direction the packages are built in; a hand-written',
    'map from a grant kind to a tool name would be an opinion in a column that',
    'claims to be derived, which is the classifier this report already deleted',
    'once. So two axes are measured and the third is named. Measuring it means',
    'a derivation that lives above both packages, and that is a decision about',
    'where this script lives rather than a row somebody can add.',
    '',
    '### Features, by path',
    '',
    'Each cell is *executed / held*: what the engine applies, over what the',
    'class and its subclass have granted by that level. **Manual is not',
    'failure** here any more than it is in the Classes table — several features',
    'are judgement the engine should never take from a DM — but a party',
    'planning a level can see which of its sentences the engine will apply and',
    'which the table will.',
    '',
    `| Path | ${levels.join(' | ')} |`,
    `|---|${levels.map(() => '---').join('|')}|`,
  );

  for (const path of coverage.paths) {
    const cells = path.levels.map((one) => `${one.executed}/${one.features}`);
    lines.push(`| ${path.name} | ${cells.join(' | ')} |`);
  }

  lines.push(
    '',
    '### Spells in reach, by path',
    '',
    'Each cell is *executed / tracked / in reach*, and the first two are never',
    'added: a tracked spell is cast for real and its effect narrated, which is',
    'the right answer for Disguise Self and would be a lie about Fireball. A',
    'class that never casts has no row here; a class whose table starts its',
    'slots later starts its row later, because the reach is read off the table',
    'the book prints rather than from a rule about casters written into the',
    'script.',
    '',
    '**The reach is the class’s list, on a row named for a path**, and that is',
    'the one place this section’s unit and its numbers differ: a spell is in',
    'reach because the book’s index puts it on the class’s list, so a spell a',
    'subclass grants that is not on that list is not counted here. Said rather',
    'than smoothed over, because the alternative is a column that quietly means',
    'something other than its heading.',
    '',
    `| Path | ${levels.join(' | ')} |`,
    `|---|${levels.map(() => '---').join('|')}|`,
  );

  for (const path of coverage.paths) {
    if (path.levels.every((one) => one.reachable === 0)) continue;
    const cells = path.levels.map(
      (one) => `${one.executedSpells}/${one.tracked}/${one.reachable}`,
    );
    lines.push(`| ${path.name} | ${cells.join(' | ')} |`);
  }

  return lines;
}

function renderBlockers(): readonly string[] {
  const rows = allShapeConsumers();
  const lines = [
    '',
    '## What blocks the rest',
    '',
    'Derived from `packages/content/scripts/missing-shapes.ts`, which holds one',
    'missing-shape vocabulary and every spell blocked on it — the executed',
    'definitions carrying a clause they do not finish, the tracked ones, and all',
    'the parsed spells with no definition at all.',
    '',
    '**Blocks** is every spell a shape touches. **Finishes** is the spells it is',
    'the *only* blocker for — the ones building it would complete. Those are',
    'different numbers, and reporting only the first is how one family came to be',
    'ranked three different ways in three different documents.',
    '',
    '**Finishes is split in two**, and that difference is the second finding.',
    '*Read* counts the spells whose SRD paragraph has been read sentence by',
    'sentence — every sentence tripping one of the guard’s mechanical markers',
    'carries a written clause saying which of four things it is. *Unread* counts',
    'the rest, whose entry names a blocker and says nothing about the sentences',
    'beside it. Every wrong prediction this map has made — Mind Blank, Protection',
    'from Energy, Enthrall, Magic Weapon, True Strike — was an unread sentence',
    'rather than a wrong entry, so the first column is what a tranche may be',
    'planned from and the second is what it may be planned from once somebody',
    'reads it.',
    '',
    '*Read* is a **floor, not a proof.** The markers read English, so a rule the',
    'SRD phrases in none of their words trips nothing and is demanded of nobody —',
    'Gaseous Form’s "can enter and occupy the space of another creature" is one,',
    'and is recorded because somebody read the paragraph rather than because the',
    'guard asked. What the column promises is that every sentence the markers can',
    'see has an answer, which is the same promise the tracked bucket’s guard has',
    'always made in the same words.',
    '',
    '**Unseen** is that floor counted rather than described: the tracked spells',
    'whose claim on a shape is a sentence no marker can see. Those entries exist',
    'because a reader wrote them, and until they were allowed a spell leaving the',
    'undefined population dropped every one of them — after which "no shape sits',
    'unclaimed" demanded the shape be retired, deleting a gap that is still real.',
    'Every *Unseen* entry is a shape that would have gone that way. It is a subset',
    'of *Tracked* and is never added to it.',
    '',
    '| Shape | Blocks | Finishes (read) | Finishes (unread) | Executed | Tracked | of which unseen | Undefined |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    lines.push(
      `| \`${row.shape}\` | ${row.blocks.length} | ${row.unblocksRead.length} | ${row.unblocksUnread.length} | ${row.executed.length} | ${row.tracked.length} | ${row.unseen.length} | ${row.undefined.length} |`,
    );
  }
  lines.push(
    '',
    'A spell can need more than one shape, so the columns do not sum to the',
    'population. A spell blocked on **nothing** — genuinely the table’s, and the',
    'engine could take it today — is recorded as such rather than omitted.',
  );
  return lines;
}

function render(coverage: SpellCoverage): string {
  const verified = new Set(VERIFIED_SPELLS);
  const partial = new Set(PARTIAL_SPELLS);
  const pct = (n: number) => `${((n / coverage.total) * 100).toFixed(1)}%`;

  const lines: string[] = [
    '# SRD 5.2.1 coverage',
    '',
    '> Generated by `npm run coverage`. Do not edit by hand — edit the script,',
    '> or better, make the number go up.',
    '',
'Five states, and the middle ones are different claims that are never added',
    'together:',
    '',
    '| | Means |',
    '|---|---|',
    '| **Parsed** | `@ie/srd` has the record: id, level, school, class list, prose |',
    '| **Tracked** | the engine casts it for real — action, slot, Concentration, duration — and says what the DM adjudicates |',
    '| **Executed** | a definition whose effects the engine resolves: dice, saves, targets, scaling |',
    '| **Partial** | executed, and one of its `unmodelled` clauses is a rule the engine owns and has not built |',
    '| **Verified** | an integration test drives it end to end through the public API |',
    '',
    'A catalogue entry is not an implementation. Neither is a refusal saying the',
    'spell is unsupported.',
    '',
    '**Partial and verified are different axes**, so a spell can be both: Web is',
    'driven end to end and still leaves its Difficult Terrain unbuilt. Partial is',
    'not a list at all — it is derived from the adjudication map in',
    '`packages/content/scripts/missing-shapes.ts`: a spell is partial because one',
    'of its `unmodelled` clauses is adjudicated to a named missing shape rather',
    'than to the table.',
    '',
    '## Spells',
    '',
    `| Parsed | Tracked | Executed | of which partial | Verified |`,
    `|---|---|---|---|---|`,
    `| ${coverage.total} | ${coverage.tracked} (${pct(coverage.tracked)}) | ${coverage.executed} (${pct(coverage.executed)}) | ${coverage.partial} | ${coverage.verified} (${pct(coverage.verified)}) |`,
    '',
    'A **tracked** spell is not a half-finished executed one. Disguise Self will',
    'never be executed, because what the caster looks like is not arithmetic;',
    'what the engine owes it is the slot, the action, the hour on the clock, and',
    'a plain statement of what the table decides.',
  ];

  const named = (want: 'tracked' | 'executed') =>
    [...SPELL_DEFINITIONS]
      .filter((d) => (TRACKED_IDS.has(d.id) ? 'tracked' : 'executed') === want)
      .sort((a, b) => a.id.localeCompare(b.id));

  lines.push('', '### Executed today', '');
  for (const definition of named('executed')) {
    // Two axes, so both are said: whether a test drives it, and whether it
    // finishes. A verified spell carrying a debt used to print only the tick.
    const driven = verified.has(definition.id) ? 'verified' : 'untested';
    const mark = partial.has(definition.id)
      ? `${driven}, partial — a clause the engine owns is still unbuilt`
      : driven;
    const level = definition.level === 0 ? 'cantrip' : `level ${definition.level}`;
    lines.push(`- **${definition.name}** (${level}) — ${mark}`);
  }

  lines.push('', '### Tracked today', '');
  lines.push(
    'Cast for real; the effect is narrated. Each says what it leaves to the DM.',
    '',
    'A spell marked *read* carries a blocker **no mechanical marker could have',
    'demanded**: the sentence is written in none of the guard’s words, so nothing',
    'asked for it and somebody recorded it because they read the paragraph. Those',
    'are the entries the *Read* column below is a floor over rather than a proof',
    'of, told apart from the ones a marker found.',
    '',
  );
  for (const definition of named('tracked')) {
    const level = definition.level === 0 ? 'cantrip' : `level ${definition.level}`;
    const unseen = (TRACKED_ADJUDICATED[definition.id] ?? []).filter(
      (entry) => entry.marker === null,
    ).length;
    const read = unseen === 0 ? '' : `, ${unseen} read`;
    lines.push(
      `- **${definition.name}** (${level}) — ${(definition.unmodelled ?? []).length} noted${read}`,
    );
  }

  lines.push(...renderBlockers());
  lines.push(...renderClasses(auditClasses()));
  lines.push(...renderOrigins(auditOrigins()));
  lines.push(...renderMagicItems(auditMagicItems()));
  lines.push(...renderBestiary(auditBestiary()));
  lines.push(...renderPlayableLevels(auditPlayableLevels()));

  return `${lines.join('\n')}\n`;
}

/**
 * The whole report as text, measured but not written.
 *
 * Exported so `coverage.test.ts` can hold the text the *next* run would
 * produce to the same rules it holds the committed file to — a prose number
 * introduced here should fail on the commit that introduces it, not one commit
 * later when somebody regenerates. It writes nothing, which is the only thing
 * the sweep in `coverage-script.test.ts` cares about.
 */
export function renderReport(): string {
  return render(auditSpells());
}

/** True when Node was asked to run this file, rather than something importing it. */
const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMainModule) {
  // Two refusals, both before anything is written, because a report is worse
  // than no report when it is wrong. The first: `tsx` resolves `@ie/content`
  // through `dist`, so a build behind its source measures yesterday's
  // catalogue against today's lists. The second: the contradiction that used
  // to be written into the file as a line of prose.
  refuseStaleBuild(dryBuild());
  const found = coverageInconsistencies();
  if (found.length > 0) {
    throw new Error(
      ['COVERAGE.md was not written: the measurement contradicts itself.', ...found].join('\n'),
    );
  }

  const coverage = auditSpells();
  writeFileSync('COVERAGE.md', render(coverage), 'utf8');
  console.log(
    `spells: ${coverage.executed}/${coverage.total} executed, ` +
      `${coverage.tracked} tracked, ${coverage.verified} verified`,
  );
  const classes = auditClasses();
  console.log(
    `classes: ${classes.classes}/12 with ${classes.subclasses} subclasses; ` +
      `${classes.executed}/${classes.features} features executed`,
  );
  const origins = auditOrigins();
  console.log(
    `origins: ${origins.species} species and ${origins.backgrounds} backgrounds; ` +
      `${origins.executed}/${origins.features} features executed`,
  );
  const items = auditMagicItems();
  console.log(
    `magic items: ${items.transcribed}/${items.parsed} entries transcribed as ` +
      `${items.instances} records, ${items.partial} of them partial`,
  );
  const bestiary = auditBestiary();
  console.log(
    `bestiary: ${bestiary.carried}/${bestiary.parsed} stat blocks carried, ` +
      `${bestiary.printed} printed lines the engine does not read`,
  );
  const piles = itemPiles(parsedItemIds(), transcribedItemIds());
  console.log(
    `item entries: ${piles.blocked.length} blocked, ${piles.ready.length} ready to transcribe, ` +
      `${piles.fiction.length} the table's, ${piles.unread.length} unread`,
  );
}
