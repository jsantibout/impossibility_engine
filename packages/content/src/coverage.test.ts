import { readFileSync, readdirSync } from 'node:fs';
import { SPELL_DEFINITIONS, SPELL_STAT_BLOCKS, SRD_CONTENT, SRD_MAGIC_ITEMS } from '@ie/content';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MonsterTraitSchema, SPELL_INDEX, spellById } from '@ie/srd';
import { adaptMonster } from '@ie/engine';
import { asCharacterId } from '@ie/shared';
import {
  PARTIAL_SPELLS,
  VERIFIED_SPELLS,
  auditBestiary,
  auditClasses,
  auditMagicItems,
  auditOrigins,
  coverageInconsistencies,
  inconsistencies,
  isExecuted,
  isExecutedFeature,
  isHandoverTrait,
  isReadLine,
  hasUnexecutedTrait,
  statBlockLines,
  HANDOVER_TRAIT_KINDS,
  TRAIT_KINDS_WITH_A_READER,
} from '../scripts/coverage-data.js';
import { TRACKED_ADJUDICATED } from '../scripts/missing-shapes.js';
import { entryFor, isCompleteItem, magicItemEntries } from '../scripts/magic-items.js';
import { bestiaryRow, bestiarySummary, renderReport } from '../scripts/coverage.js';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * The coverage claim, kept honest.
 *
 * `COVERAGE.md` is generated, and a generated claim nothing checks is exactly
 * the failure it exists to prevent — a project that believes it is finished
 * because a table says so. So the three states are asserted here:
 *
 * - **executable** must be **parsed**: a definition whose id, level or school
 *   has drifted from the book is a definition of a spell that does not exist.
 * - **verified** must be **executable**: a test cannot drive what the engine
 *   cannot resolve.
 * - Every definition's class list must match the SRD's, because who can cast a
 *   spell is half of whether a character may cast it.
 */

describe('every executable spell is a spell the SRD actually has', () => {
  it.each(SPELL_DEFINITIONS.map((d) => [d.id, d] as const))(
    'agrees with the book about %s',
    (id, definition) => {
      const parsed = spellById(id);
      expect(parsed, `${id} is not in the parsed SRD`).not.toBeNull();
      if (parsed === null) return;

      expect(parsed.name).toBe(definition.name);
      expect(parsed.level).toBe(definition.level);
      expect(parsed.school).toBe(definition.school);
    },
  );

  /**
   * SRD writes a casting time in prose; the engine has four kinds. A spell
   * whose printed time is an Action must not be defined as a Bonus Action —
   * that is a free action every turn, invented by a typo.
   */
  it.each(SPELL_DEFINITIONS.map((d) => [d.id, d] as const))(
    'agrees with the book about how long %s takes to cast',
    (id, definition) => {
      const parsed = spellById(id);
      if (parsed === null) return;

      const printed = parsed.castingTime.toLowerCase();
      const expected =
        printed.startsWith('bonus action')
          ? 'bonus-action'
          : printed.startsWith('reaction')
            ? 'reaction'
            : printed.startsWith('action')
              ? 'action'
              : 'long';
      expect(definition.castingTime).toBe(expected);
    },
  );

  it.each(SPELL_DEFINITIONS.map((d) => [d.id, d] as const))(
    'agrees with the book about whether %s needs Concentration',
    (id, definition) => {
      const parsed = spellById(id);
      if (parsed === null) return;
      expect(definition.concentration).toBe(parsed.concentration);
    },
  );
});

/**
 * A tracked spell is one the engine casts and does not execute: the slot, the
 * action, the Concentration and the clock are real, and the effect is the DM's.
 * The obligation that makes that honest rather than a stub is that it must say
 * so, and `unverified` carries `unmodelled` to the narrating layer on every
 * casting.
 *
 * **Two lists satisfy the obligation, and they make different claims.** A gap
 * is a debt somebody may pay; a handover is a question nobody here will ever
 * answer, and `unverified` carries both under marks that tell them apart. The
 * rule below reads them together because what it guards is that a tracked
 * definition says *something* — a spell whose every sentence is the GM's is
 * the most honest kind there is, and Legend Lore is one: the book says the GM
 * twice in six sentences, all six are handed over, and nothing is owed.
 */
describe('a spell the engine tracks says what it does not do', () => {
  // A spell whose casting resolves nothing is **tracked** only if nothing
  // else in it resolves either. Flame Blade's every blow comes through its
  // activation and Web's every save through its area, and neither is a spell
  // the engine has declined to execute. `isExecuted` is imported rather than
  // restated: this file held two copies of it, and the second had lost the
  // `areaTrigger` arm.
  const tracked = SPELL_DEFINITIONS.filter((d) => !isExecuted(d));

  it('has some, so the rule below is not vacuous', () => {
    expect(tracked.length).toBeGreaterThan(0);
  });

  it.each(tracked.map((d) => [d.id, d] as const))(
    'leaves %s nothing unexplained',
    (_id, definition) => {
      expect([...(definition.unmodelled ?? []), ...(definition.dmDecides ?? [])]).not.toEqual([]);
    },
  );

  /**
   * And the second list is not a way out of the first.
   *
   * It used to be "exactly one, named here", and P3-S6 made that the wrong
   * shape of rule rather than a stale number: thirty-two tracked definitions
   * account for themselves with a handover alone now, because somebody read
   * every sentence of each against the book and found no debt. A list of
   * thirty-three names would be a second copy of that reading kept by hand.
   *
   * So the rule asks for the reading instead: a definition that declares no
   * debt at all must have a `TRACKED_ADJUDICATED` entry — the map
   * `spellShapesOf` counts and `LEDGER.md` prints — and none of that entry may
   * name a shape, because a spell waiting on a shape owes a debt and has just
   * said it owes none. That is strictly more than a name list asked for, and
   * it cannot go stale.
   *
   * **Legend Lore is the exception and is named, which is what the old rule
   * was for.** It was re-filed by the `dmDecides` sweep, it is a level 5 spell
   * and so was never in level-5 reach, and the guard that demands a reading of
   * every tracked spell restricts itself to that reach — so nobody has ever
   * been asked to read it, and pretending otherwise here would be this file
   * inventing a population.
   */
  it('lets a tracked spell hand everything over only where somebody read it to the end', () => {
    const handoverOnly = tracked.filter((d) => (d.unmodelled ?? []).length === 0);
    expect(handoverOnly.length).toBeGreaterThan(1);
    for (const definition of handoverOnly) {
      expect((definition.dmDecides ?? []).length, definition.id).toBeGreaterThan(0);
      if (definition.id === 'legend-lore') continue;
      const entries = TRACKED_ADJUDICATED[definition.id] ?? [];
      expect(entries.length, `${definition.id} owes nothing and nobody recorded reading it`).toBeGreaterThan(0);
      expect(
        entries.filter((entry) => entry.why !== 'table' && entry.why !== 'engine'),
        `${definition.id} declares no debt and its map entry names a shape`,
      ).toEqual([]);
    }
    expect(handoverOnly.map((d) => d.id)).toContain('legend-lore');
  });

  /** And an executed spell is still allowed to have nothing to declare. */
  it('does not demand a note from a spell that does everything it says', () => {
    const executed = SPELL_DEFINITIONS.filter(isExecuted);
    expect(executed.some((d) => (d.unmodelled ?? []).length === 0)).toBe(true);
  });
});

describe('the coverage table cannot claim more than the tests prove', () => {
  it('verifies only spells the engine can execute', () => {
    const executable = new Set(SPELL_DEFINITIONS.map((d) => d.id));
    expect(VERIFIED_SPELLS.filter((id) => !executable.has(id))).toEqual([]);
  });

  it('names each verified spell once', () => {
    expect(new Set(VERIFIED_SPELLS).size).toBe(VERIFIED_SPELLS.length);
  });

  /**
   * **A partial spell has to say what it is missing.** The third state earns
   * its place only while it names a clause; without that it is a green tick
   * with a softer word on it, and the table would be back to claiming
   * something nobody checked.
   */
  it('makes every partial spell name the clause it has not built', () => {
    for (const id of PARTIAL_SPELLS) {
      const definition = SPELL_DEFINITIONS.find((d) => d.id === id);
      expect(definition, id).toBeDefined();
      // **A branch's debts count**, and for a spell that prints branches they
      // may be all of them: SRD Command's own list is empty and every line it
      // owes belongs to one of the five words. `spell-honesty.test.ts` reads
      // them the same way, and for the same reason — a clause filed one level
      // down is still the spell's.
      const owed = [
        ...(definition!.unmodelled ?? []),
        ...Object.values(definition!.options ?? {}).flatMap(
          (branch) => branch.unmodelled ?? [],
        ),
      ];
      expect(owed, id).not.toEqual([]);
    }
  });

  /**
   * **Partial and verified are two axes, not two values of one.**
   *
   * They were kept apart while `PARTIAL_SPELLS` held one spell that no test
   * drove end to end, and that reading does not survive the honesty guard
   * reaching the executed bucket: partial now means *a clause of this spell is
   * adjudicated to a missing shape*, and a spell can be driven end to end and
   * still leave one unbuilt. Banishment is exactly that — the save is rolled,
   * the Incapacitated lands and the minute runs, and the demiplane the target
   * was supposed to spend it in is a second place the engine has nowhere to
   * put anybody. Rendering only the tick would be the green tick this third
   * state was invented to prevent, so the report says both.
   *
   * **Web used to be the example and no longer is**, which is the axis working:
   * "while in the webs" was built, and the two sentences it has left — the
   * collapse and the fire — are both the table's, so the spell is executed
   * whole and carries no debt to name. An exemplar leaving this bucket is what
   * progress looks like from here.
   */
  it('lets a spell be driven end to end and still carry a debt', () => {
    const both = PARTIAL_SPELLS.filter((id) => VERIFIED_SPELLS.includes(id));
    expect(both.length).toBeGreaterThan(0);
    expect(both).toContain('banishment');
  });

  /** And in the order two branches can both append to, as the neighbours are. */
  it('names the partial spells in an order two branches can both append to', () => {
    expect(PARTIAL_SPELLS).toEqual([...PARTIAL_SPELLS].sort());
  });

  /**
   * And in an order two branches can both append to.
   *
   * Nothing above constrains the order — both neighbours compare sets — so a
   * merge resolution is free to scramble this list, and the next person to add
   * a spell conflicts with it again. Sorted, two additions usually land in
   * different places and never need resolving at all.
   */
  it('names them in an order two branches can both append to', () => {
    expect(VERIFIED_SPELLS).toEqual([...VERIFIED_SPELLS].sort());
  });

  /** The denominator is real: this is the whole SRD, not a sample of it. */
  it('measures against every parsed spell', () => {
    expect(SPELL_INDEX.length).toBe(339);
  });
});

/**
 * The registry is a list two branches both append to.
 *
 * Sorted, two people adding a spell append in different places and never meet.
 * Unsorted — as this list was, with seventeen utility spells prepended out of
 * order — every addition lands at whatever line looked reasonable, which means
 * every pair of additions is a conflict at the same hunk. And the resolution of
 * that conflict is where an entry gets dropped or landed twice, neither of
 * which anything else here would notice.
 */
describe('the catalogue is a list a merge cannot quietly damage', () => {
  const ids = () => SPELL_DEFINITIONS.map((d) => d.id);

  it('names each spell once', () => {
    expect(new Set(ids()).size).toBe(ids().length);
  });

  it('is sorted by id', () => {
    expect(ids()).toEqual([...ids()].sort());
  });

  /**
   * The failure a bad resolution actually produces: a spell still *declared*
   * and no longer *registered*. It compiles, it lints, and `definitionFor`
   * simply stops finding it — so the engine reports a spell it has been taught
   * as one it has never heard of.
   *
   * Read out of the source, the way `persistence.test.ts` reads the event
   * union, because the whole point is to catch what the type system cannot:
   * a definition that exists as a value nobody put in the list.
   */
  it('registers every spell the file declares', () => {
    const source = readFileSync(`${here}spells.ts`, 'utf8');

    // Each `export const` up to the next one; a block carrying an `id` is a
    // spell definition, which leaves out DIRECTIONAL_AREAS and the list itself.
    const blocks = source.split(/^export const /m).slice(1);
    const declared = blocks
      .map((block) => /^\s*id: '([a-z0-9-]+)'/m.exec(block)?.[1])
      .filter((id): id is string => id !== undefined);

    expect(declared.length).toBeGreaterThan(80);
    expect([...declared].sort()).toEqual([...ids()].sort());
  });
});

/**
 * Every population the report counts, held to the predicate the code uses.
 *
 * **The class column is trustworthy because `isExecuted` is exported and
 * shared rather than copied** — `coverage-data.ts` records what a drifting
 * copy of it cost — and the populations added here are held to the same rule:
 * the count in the table and the count asserted below come out of one
 * predicate, so a test agreeing with a second spelling of it would agree with
 * the wrong answer.
 */
describe('the report counts what the catalogue holds', () => {
  const originFeatures = [
    ...SRD_CONTENT.species.flatMap((one) => one.features),
    ...SRD_CONTENT.backgrounds.flatMap((one) => one.features),
  ];
  const classFeatures = [
    ...SRD_CONTENT.classes.flatMap((one) => one.features),
    ...SRD_CONTENT.subclasses.flatMap((one) => one.features),
  ];

  /**
   * Nine species and four backgrounds were transcribed with every
   * unexecutable trait marked `manual` and a note saying what a DM is left
   * holding — honest, and invisible, because `auditClasses` audits classes.
   */
  it('counts an origin’s features, and reads their automation rather than guessing', () => {
    const origins = auditOrigins();
    expect(origins.features).toBe(originFeatures.length);
    expect(origins.executed).toBe(originFeatures.filter(isExecutedFeature).length);
    expect(origins.species).toBe(SRD_CONTENT.species.length);
    expect(origins.backgrounds).toBe(SRD_CONTENT.backgrounds.length);
  });

  /** The rows are the totals, so neither can drift from the other. */
  it('totals its origin rows', () => {
    const origins = auditOrigins();
    expect(origins.rows.reduce((sum, row) => sum + row.features, 0)).toBe(origins.features);
    expect(origins.rows.reduce((sum, row) => sum + row.executed, 0)).toBe(origins.executed);
    expect(origins.rows).toHaveLength(SRD_CONTENT.species.length + SRD_CONTENT.backgrounds.length);
  });

  /**
   * Neither column is vacuous: something is executed and something is not, so
   * a predicate that answered one way for everything would be caught.
   */
  it('finds both answers among the origin features', () => {
    expect(originFeatures.some(isExecutedFeature)).toBe(true);
    expect(originFeatures.some((feature) => !isExecutedFeature(feature))).toBe(true);
  });

  /** And the class table reads that same predicate, which is the point of it. */
  it('counts a class feature with the predicate the origins table uses', () => {
    const classes = auditClasses();
    expect(classes.features).toBe(classFeatures.length);
    expect(classes.executed).toBe(classFeatures.filter(isExecutedFeature).length);
  });

  /**
   * **A feat declares no automation**, so nothing counts one. It carries a
   * note saying what a DM still applies and no field the engine reads, which
   * makes "how many feats are executed" a question with no derivation — and an
   * underived count is the prose number this file exists to keep out.
   */
  it('has nothing to read on a feat, which is why none is counted', () => {
    expect(SRD_CONTENT.feats.length).toBeGreaterThan(0);
    for (const feat of SRD_CONTENT.feats) {
      expect(Object.keys(feat), feat.id).not.toContain('automation');
      expect(feat.note.length, feat.id).toBeGreaterThan(0);
    }
  });
});

/**
 * Magic items, where **one entry is not one item** and saying otherwise would
 * be the report's largest lie.
 *
 * The book writes _Weapon, +1, +2, or +3_ once and the catalogue holds a +1, a
 * +2 and a +3 of every weapon in the table. Dividing the catalogue's record
 * count by the parsed entry count would claim the Weapons chapter was covered
 * several times over. Entries and instances are different claims, and the
 * report never adds them.
 */
describe('the magic-item counts keep entries and instances apart', () => {
  const items = auditMagicItems();

  it('measures against every entry the book prints', () => {
    expect(items.parsed).toBe(magicItemEntries().length);
  });

  it('counts an instance for every catalogue record', () => {
    expect(items.instances).toBe(SRD_MAGIC_ITEMS.length);
    expect(items.complete + items.partial).toBe(items.instances);
    expect(items.complete).toBe(SRD_MAGIC_ITEMS.filter(isCompleteItem).length);
  });

  /**
   * The finding this section exists for: far fewer entries are transcribed
   * than there are records, because four of them are templates. A report that
   * could not tell the two apart would print the larger number.
   */
  it('counts an entry once however many records it expands to', () => {
    const entries = new Set(SRD_MAGIC_ITEMS.map((item) => entryFor(item).id));
    expect(items.transcribed).toBe(entries.size); // shared join
    expect(items.transcribed).toBeLessThan(items.instances);
    expect(items.transcribed).toBeLessThanOrEqual(items.parsed);
  });

  /** Both answers are present, so neither `complete` nor `partial` is vacuous. */
  it('finds items that finish their entry and items that do not', () => {
    expect(items.complete).toBeGreaterThan(0);
    expect(items.partial).toBeGreaterThan(0);
  });

  /** The rows are the totals, by the category the book files each entry under. */
  it('totals its category rows', () => {
    expect(items.rows.reduce((sum, row) => sum + row.parsed, 0)).toBe(items.parsed);
    expect(items.rows.reduce((sum, row) => sum + row.transcribed, 0)).toBe(items.transcribed);
    expect(items.rows.reduce((sum, row) => sum + row.instances, 0)).toBe(items.instances);
  });

  /** The entry list is those entries, in an order a merge cannot scramble. */
  it('names each transcribed entry once, sorted', () => {
    const names = items.entries.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort());
    expect(names).toHaveLength(items.transcribed);
  });
});

/**
 * The bestiary, where the honest claim is the *smallest* one the numbers
 * support.
 *
 * A stat block is one record and one record is one creature, so the trap the
 * magic items set — entries against instances — is not this section's. Its
 * trap is the opposite: every block is carried, every block adapts, and a row
 * saying `330 | 330` reads as a finished bestiary when what the engine holds
 * is the half of a stat block that is a number. What it does on its turn is
 * the SRD's prose, and the report says how much of it there is rather than
 * saying "some" in a sentence.
 *
 * So the tests here hold three things: the catalogue carries every block the
 * parser produced, the printed-line count is every line of every block, and
 * **a printed line is prose unless the parser read it**, in which case it is
 * counted in a column of its own. That third test used to say a line held
 * nothing but a name and a sentence, and it went red the day the parser
 * structured the first attack line — exactly as it was written to. The row
 * grew the column rather than going on claiming the same thing about a
 * different population, and the test now holds the two fields a read line may
 * carry, so a third one cannot arrive uncounted either.
 */
/**
 * A trait kind on neither list, which is what the next one the parser learns
 * will be on the day it lands.
 *
 * Written here rather than found in the schema because there is nothing left
 * to find: every kind the schema admits is now spent or handed over. The
 * predicate still has to answer `true` for one that is neither, so the
 * question is asked of a name and the two lists are held to the schema and to
 * the engine's sources by the sweeps that always held them.
 */
const UNREAD_KIND = 'a-sentence-nobody-has-read-yet';

describe('the bestiary row counts blocks, and the prose it cannot read', () => {
  const bestiary = auditBestiary();

  it('measures against every stat block the parser produced', () => {
    const parsed = JSON.parse(
      readFileSync('packages/srd/src/generated/monsters.json', 'utf8'),
    ) as readonly { readonly id: string }[];

    expect(bestiary.parsed).toBe(parsed.length);
    expect(bestiary.parsed).toBeGreaterThan(0);
  });

  /**
   * *Carried* is not *parsed* restated: `checkContent` validates every block
   * on the way in, so a block the schema refused would be parsed and absent.
   * The ids are compared rather than the two lengths, which would agree by
   * accident if one block were swapped for another.
   *
   * **And the catalogue is parsed *plus* the blocks the book prints inside a
   * spell's own entry**, which is the one way the two sets differ and the
   * reason they are unioned rather than compared. The SRD prints the
   * Otherworldly Steed's whole stat block in Find Steed's entry and names a
   * Riding Horse with one number changed in Phantom Steed's; the parser reads
   * the Monsters chapter and never sees either. The owner's ruling of
   * 2026-09-21 files both as bestiary entries, so they are transcribed by hand
   * in `bestiary.ts` and validated by the schema every parsed block is
   * validated by. `SPELL_STAT_BLOCKS` is named here rather than subtracted by
   * a difference, so a block that appeared in the catalogue from anywhere else
   * still fails.
   */
  it('carries every parsed block, and the blocks a spell prints, by id', () => {
    const parsed = JSON.parse(
      readFileSync('packages/srd/src/generated/monsters.json', 'utf8'),
    ) as readonly { readonly id: string }[];

    expect(bestiary.carried).toBe(SRD_CONTENT.monsters.length);
    expect(SRD_CONTENT.monsters.map((m) => m.id).sort()).toEqual(
      [...parsed.map((m) => m.id), ...SPELL_STAT_BLOCKS.map((m) => m.id)].sort(),
    );
  });

  it('counts a printed line for every trait and action in the catalogue', () => {
    const lines = SRD_CONTENT.monsters.reduce(
      (sum, m) =>
        sum +
        m.traits.length +
        m.actions.length +
        m.bonusActions.length +
        m.reactions.length +
        m.legendaryActions.length,
      0,
    );

    expect(bestiary.printed).toBe(lines);
    expect(bestiary.rows.reduce((sum, row) => sum + row.printed, 0)).toBe(bestiary.printed);
  });

  /**
   * The claim the row would be dishonest without, in both directions. A
   * printed line is a name and the book's sentence, **plus** at most the
   * fields a parser fills when it read that sentence — an attack's numbers, a
   * trait's mechanic, the DC and dice of a save the line forces, a
   * Multiattack's sequence, and what the heading says brings the line back. A
   * field beyond them would be a population the row is not counting, so it
   * fails here rather than quietly joining the *read* column.
   *
   * `recharge` and `perDay` are read off the **name** rather than the
   * sentence, which is why they change nothing about what "read" counts: a
   * line whose prose the parser got nothing out of is still unread with a
   * recharge or a daily limit on it. Both joined this list in the commit that
   * taught the parser to read them, which is the only way a field joins it.
   */
  it('finds nothing in a printed line but a name, prose, and what was read out of it', () => {
    const keys = new Set<string>();
    for (const monster of SRD_CONTENT.monsters) {
      for (const line of [
        ...monster.traits,
        ...monster.actions,
        ...monster.bonusActions,
        ...monster.reactions,
        ...monster.legendaryActions,
      ]) {
        for (const key of Object.keys(line)) keys.add(key);
      }
    }

    expect([...keys].sort()).toEqual([
      // What SRD Parry adds to its own Armour Class, and the name of the line
      // SRD Reflexive Antennae's response performs: the Reactions section's
      // other two templates, each read out of the sentence like the rest.
      'addsToAc',
      'addsToRoll',
      'attack',
      'casts',
      'multiattack',
      'name',
      'perDay',
      'recharge',
      'save',
      'spellcasting',
      'teleports',
      'text',
      'trait',
      'usesLine',
    ]);
  });

  /**
   * **Reading a sentence is not spending what it says**, and the two columns
   * must not be allowed to collapse into one.
   *
   * A trait kind reaches `CharacterSheet.stated.traits` the moment the parser
   * matches its sentence; whether anything *asks* for it is a call site, and
   * `TRAIT_KINDS_WITH_A_READER` is where that is written down. The default is
   * the conservative one — a kind nobody has listed is a debt — so the list
   * can only lie by holding a name it should not, and it can do that two ways.
   *
   * **A name the schema no longer admits** is the loud one. **A name whose
   * reader has been deleted** is the dangerous one: nothing would fail, and
   * eighteen lines of real debt would leave the ledger with every test green.
   * So both are asked, and the second is asked of the engine's own sources —
   * the question `spell-schema.test.ts` asks of them, pointed the other way.
   */
  it('names only trait kinds the schema admits, as the kinds with a reader', () => {
    const kinds: readonly string[] = MonsterTraitSchema.options.map(
      (option) => option.shape.kind.value,
    );
    expect(kinds.length).toBeGreaterThan(1);
    expect(TRAIT_KINDS_WITH_A_READER.length).toBeGreaterThan(0);
    expect(TRAIT_KINDS_WITH_A_READER.filter((kind) => !kinds.includes(kind))).toEqual([]);

    // **And the predicate answers both ways**, asked of a kind on the list and
    // of one that is not. A guard that only ever expected `false` would pass
    // against `() => false`, which is the answer that quietly retires the row.
    //
    // A handed-over kind is on neither side of this question — it is read and
    // finished — so it is excluded from the search for an unspent one.
    //
    // **And there are two real ones to find again**, which is the column
    // coming back off zero exactly as the note that emptied it said it would:
    // the day the parser learns a shape nothing reads, this rises and the
    // guard is the same. Both are Reactions the bestiary prints and the engine
    // has no seam for — an ooze that becomes two oozes mid-fight, and a goblin
    // that swaps places with an ally and re-aims the attack — and both are
    // *named* here rather than counted, so a kind that quietly joined or left
    // them is a diff. `HANDOVER_TRAIT_KINDS` holds the seam each waits on.
    const spent = TRAIT_KINDS_WITH_A_READER[0]!;
    const inert = kinds.filter(
      (kind) =>
        !TRAIT_KINDS_WITH_A_READER.includes(kind) && !Object.hasOwn(HANDOVER_TRAIT_KINDS, kind),
    );
    expect([...inert].sort()).toEqual([
      'splits-into-two-creatures',
      'swaps-places-with-an-ally-to-take-an-attack',
    ]);
    expect(hasUnexecutedTrait({ name: 'x', text: 'y' })).toBe(false);
    expect(hasUnexecutedTrait({ name: 'x', text: 'y', trait: { kind: spent } })).toBe(false);
    expect(hasUnexecutedTrait({ name: 'x', text: 'y', trait: { kind: UNREAD_KIND } })).toBe(true);
  });

  /**
   * And the other direction: a kind is on the list because something reads it,
   * so the reader has to still be there.
   *
   * Asked of the engine's sources rather than of a second list, because a
   * second list is the thing that goes stale. A kind named nowhere in
   * `packages/engine/src` is a kind nothing can be spending.
   */
  it('names no trait kind the engine has stopped reading', () => {
    const here = fileURLToPath(new URL('.', import.meta.url));
    const root = `${here}../../engine/src/`;
    const sources: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(`${dir}${entry.name}/`);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          sources.push(readFileSync(`${dir}${entry.name}`, 'utf8'));
        }
      }
    };
    walk(root);
    // Not vacuous: the walk found the engine rather than an empty directory.
    expect(sources.length).toBeGreaterThan(40);

    const text = sources.join('\n');
    expect(TRAIT_KINDS_WITH_A_READER.filter((kind) => !text.includes(`'${kind}'`))).toEqual([]);
  });

  /**
   * The third answer, and it is pinned the **opposite** way round.
   *
   * A handed-over kind is one the engine reads, gives to the table and will
   * never build — `docs/ROADMAP.md` §6 P3-B says so of the breathing traits in
   * as many words — so it is neither spent nor waiting, and it drops out of
   * both of the columns above. That is a claim worth two guards, because it
   * can be wrong two ways.
   *
   * **A name the schema no longer admits** is the loud one, exactly as it is
   * for the roster. **A kind that has quietly grown a reader** is the
   * dangerous one: it would go on being reported as handed over while
   * something in the engine spent it, which is the same drift pointed the
   * other way. So the second guard is the roster's, inverted — a handover
   * must be named **nowhere** in `packages/engine/src`.
   *
   * And no kind may be on both lists, which is what would make the two
   * predicates disagree about one line.
   */
  it('hands over only kinds the schema admits and no reader spends', () => {
    const kinds: readonly string[] = MonsterTraitSchema.options.map(
      (option) => option.shape.kind.value,
    );
    const handovers = Object.keys(HANDOVER_TRAIT_KINDS);
    expect(handovers.length).toBeGreaterThan(0);
    expect(handovers.filter((kind) => !kinds.includes(kind))).toEqual([]);
    expect(handovers.filter((kind) => TRAIT_KINDS_WITH_A_READER.includes(kind))).toEqual([]);

    // Every one carries its own reason, because the day one of them stops
    // being a handover it will be one of them and not all three.
    for (const [kind, reason] of Object.entries(HANDOVER_TRAIT_KINDS)) {
      expect(reason.length, kind).toBeGreaterThan(80);
    }

    const here = fileURLToPath(new URL('.', import.meta.url));
    const root = `${here}../../engine/src/`;
    const sources: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(`${dir}${entry.name}/`);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          sources.push(readFileSync(`${dir}${entry.name}`, 'utf8'));
        }
      }
    };
    walk(root);
    expect(sources.length).toBeGreaterThan(40);

    const text = sources.join('\n');
    expect(handovers.filter((kind) => text.includes(`'${kind}'`))).toEqual([]);
  });

  /**
   * And the predicate answers all three ways, asked of a handover, of a kind
   * with a reader, and of a line with no trait at all.
   *
   * The middle one is what a predicate written as "any kind not on the roster"
   * would get wrong — and getting it wrong silently is how twelve printed
   * sentences would be counted twice or not at all.
   */
  it('sorts a line into exactly one of the three answers', () => {
    const handover = Object.keys(HANDOVER_TRAIT_KINDS)[0]!;
    const spent = TRAIT_KINDS_WITH_A_READER[0]!;
    // No kind the schema admits is inert any more — see the test above for why
    // the third answer is asked of a name rather than of a real kind.
    const inert = UNREAD_KIND;

    const line = (kind: string) => ({ name: 'x', text: 'y', trait: { kind } });
    expect([isHandoverTrait(line(handover)), hasUnexecutedTrait(line(handover))]).toEqual([
      true,
      false,
    ]);
    expect([isHandoverTrait(line(spent)), hasUnexecutedTrait(line(spent))]).toEqual([false, false]);
    expect([isHandoverTrait(line(inert)), hasUnexecutedTrait(line(inert))]).toEqual([false, true]);
    expect(isHandoverTrait({ name: 'x', text: 'y' })).toBe(false);
  });

  /**
   * *Read* is counted off the lines themselves, so it cannot drift from the
   * population it is a fraction of — and it is a fraction: a report claiming
   * more read lines than printed ones would be counting something else.
   */
  it('counts the read lines as a part of the printed ones', () => {
    // Asked of the generator's own predicate rather than of a third copy of
    // the rule: two copies had already come to disagree once.
    const read = SRD_CONTENT.monsters.reduce(
      (sum, m) => sum + statBlockLines(m).filter(isReadLine).length,
      0,
    );

    expect(bestiary.read).toBe(read);
    expect(bestiary.read).toBeGreaterThan(0);
    expect(bestiary.read).toBeLessThan(bestiary.printed);
    expect(bestiary.rows.reduce((sum, row) => sum + row.read, 0)).toBe(bestiary.read);
  });

  /**
   * *Attacking* is the adapter's own answer rather than a second reading of
   * the same lines: a block counts when `addCreature` would give the creature
   * an attack the engine can roll. It is smaller than the carried pile — a
   * Commoner prints no attack the parser read, and several blocks act only
   * through prose — and that gap is the honest part of the column.
   */
  it('counts the blocks that can attack with what they print', () => {
    const attacking = SRD_CONTENT.monsters.filter(
      (monster) =>
        (adaptMonster(monster, asCharacterId(monster.id)).sheet.stated?.attacks ?? []).length > 0,
    ).length;

    expect(bestiary.acting).toBe(attacking);
    expect(bestiary.acting).toBeGreaterThan(0);
    expect(bestiary.acting).toBeLessThan(bestiary.carried);
  });

  /**
   * The defence columns are the adapter's own answer, so neither is a second
   * spelling of `classify`. Both are small and both must be non-zero, or the
   * report would be printing a column that nothing can make move.
   */
  it('reads the defence entries the engine cannot enforce off the adapter', () => {
    expect(bestiary.defences).toBe(
      SRD_CONTENT.monsters.reduce(
        (sum, m) => sum + m.vulnerabilities.length + m.resistances.length + m.immunities.length,
        0,
      ),
    );
    expect(bestiary.qualified).toBeGreaterThan(0);
    expect(bestiary.unread).toBeGreaterThan(0);
    expect(bestiary.qualified + bestiary.unread).toBeLessThan(bestiary.defences);
  });

  /**
   * The ranked account of what is still unread, which is a table rather than a
   * paragraph for the reason every other count here is one: a sentence saying
   * "Multiattack is the biggest pile" goes stale silently, and a row does not.
   *
   * No shape may find *everything* — a predicate matching every block is a
   * predicate that has stopped discriminating — and the rows must be ranked,
   * because the brief the table answers asked for a ranking and an unsorted
   * list quietly stops being one.
   *
   * **Every row finds something again.** `A trait shape nothing spends` spent
   * a while at zero — every kind the parser read had a reader or was a
   * handover — and was exempted by name so that its return to a number would
   * be a diff rather than a silence. It has returned: the two oozes that split
   * and the Goblin Boss's Redirect Attack are read as kinds with no seam
   * behind them. So the exemption is gone and the guard is the plain one it
   * was before — a predicate that goes quiet fails here.
   */
  it('ranks what the unread lines would need, and the report carries the ranking', () => {
    const report = readFileSync(
      fileURLToPath(new URL('../../../COVERAGE.md', import.meta.url)),
      'utf8',
    );

    expect(bestiary.shapes.length).toBeGreaterThan(3);
    for (const shape of bestiary.shapes) {
      expect(shape.blocks, shape.shape).toBeGreaterThan(0);
      expect(shape.blocks, shape.shape).toBeLessThan(bestiary.carried);
      expect(shape.lines, shape.shape).toBeGreaterThanOrEqual(shape.blocks);
      expect(report).toContain(`| ${shape.shape} | ${shape.blocks} | ${shape.lines} |`);
    }

    const blocks = bestiary.shapes.map((shape) => shape.blocks);
    expect(blocks).toEqual([...blocks].sort((a, b) => b - a));
  });

  /**
   * **The two populations are counted separately, and neither is divided by
   * the other.**
   *
   * The catalogue is the Monsters chapter *plus* the two stat blocks the book
   * prints inside a spell's own entry, and the run's summary used to put the
   * whole catalogue over the parsed chapter: `bestiary: 332/330 stat blocks
   * carried`. Every fraction beside it in that summary is a part over its
   * whole, so a reader meeting one above 1 has to decide whether this report
   * is counting something strange or is simply wrong — and either answer costs
   * more than the number is worth.
   *
   * So the fields the summary is built from are the two piles, each derived by
   * asking whether the parser produced that id rather than by subtracting one
   * length from another. A block that appeared in the catalogue from neither
   * source moves `transcribed` and fails the id test above, instead of
   * disappearing into a difference.
   */
  it('counts the parsed chapter and the spell-printed blocks as two piles', () => {
    expect(bestiary.fromParsed + bestiary.transcribed).toBe(bestiary.carried);
    expect(bestiary.fromParsed).toBe(bestiary.parsed);
    expect(bestiary.transcribed).toBe(SPELL_STAT_BLOCKS.length);
    expect(bestiary.transcribed).toBeGreaterThan(0);
  });

  /**
   * And the line the run prints says so. Generated once and read by the guard,
   * the way `bestiaryRow` is: a second spelling in the test would agree with
   * itself while the terminal said something else.
   */
  it('prints no fraction of one population over a smaller one', () => {
    /** Every `a/b` where `a` exceeds `b`, which is the shape of the defect. */
    const aboveOne = (text: string): readonly string[] =>
      [...text.matchAll(/(\d+)\/(\d+)/g)]
        .filter((match) => Number(match[1]) > Number(match[2]))
        .map((match) => match[0]);

    // The predicate is shown the line as it was, so it cannot quietly stop
    // seeing anything.
    expect(aboveOne('bestiary: 332/330 stat blocks carried, 329 able to attack')).toEqual([
      '332/330',
    ]);

    const summary = bestiarySummary(bestiary);
    expect(aboveOne(summary)).toEqual([]);
    expect(summary).toContain(`${bestiary.fromParsed}/${bestiary.parsed} parsed`);
    // The phrase and not the bare number: `transcribed` is 2, and a `toContain`
    // of "2" is satisfied by the 2 inside 332, 1330 or 742 — an assertion that
    // passes whatever the line says.
    expect(summary).toContain(`and ${bestiary.transcribed} more transcribed`);
    // And it still says everything it used to.
    expect(summary).toContain(`${bestiary.acting}`);
    expect(summary).toContain(`${bestiary.read}/${bestiary.printed}`);
  });

  /** Generated, like every other row: the committed report holds this one. */
  it('is the row the committed report carries', () => {
    const report = readFileSync(
      fileURLToPath(new URL('../../../COVERAGE.md', import.meta.url)),
      'utf8',
    );

    expect(report).toContain('## Bestiary');
    expect(report).toContain(bestiaryRow(bestiary));
    for (const row of bestiary.rows) {
      expect(report).toContain(`| ${row.kind} | ${row.printed} | ${row.read} |`);
    }
  });
});

/**
 * The inconsistency that started this: a spell the report calls verified and
 * cannot execute.
 *
 * It **happened**, because `npm run coverage` measured `SPELL_DEFINITIONS` out
 * of a stale `dist` while reading `VERIFIED_SPELLS` out of the script's own
 * source — two different days in one table. The old report wrote the
 * contradiction into the file as a line of prose, which is a report describing
 * its own brokenness and carrying on regardless. It stops the run now.
 */
describe('a report that contradicts itself is not written', () => {
  it('finds nothing to report about the catalogue as it stands', () => {
    expect(coverageInconsistencies()).toEqual([]);
  });

  it('reports a verified spell the catalogue cannot execute', () => {
    const found = inconsistencies(['fireball', 'wish'], new Set(['fireball']));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('wish');
  });

  it('says nothing when every verified spell is executable', () => {
    expect(inconsistencies(['fireball'], new Set(['fireball', 'wish']))).toEqual([]);
  });
});

/**
 * **No count in the report's prose**, which is rule 8 pointed at the one file
 * that is allowed to hold numbers at all.
 *
 * A number in a sentence goes stale the moment the thing it describes moves,
 * and nothing fails — the sentence just becomes false. A number in a table
 * cell is regenerated on every run and diffed by the gauntlet. So the rule is
 * that the report's sentences carry no integer: every figure it states lives
 * in a row.
 *
 * Two runs of digits are not measurements and are removed before looking: a
 * version (SRD 5.2.1), and a bonus the book prints inside an item's name
 * (_Weapon, +1, +2, or +3_). Neither can be falsified by anything the engine
 * or the catalogue does — a version is a citation and a bonus is part of a
 * title. A version needs **two** dots, so a percentage is not exempted along
 * with it. A generated bullet (`- **Fireball** (level 3) — verified`) is a row
 * in all but punctuation and is not prose; it is recognised by its generated
 * shape rather than by being a bullet.
 *
 * Both the committed file and the text the script would write next are
 * checked. The committed one is what a reader sees; the rendered one is what
 * the next run produces, and checking only the first would let a prose number
 * be introduced and noticed one commit late.
 */
describe('the report states no number outside a row', () => {
  const REPORT = fileURLToPath(new URL('../../../COVERAGE.md', import.meta.url));

  /**
   * A bullet the report *generates*: a bold name, a parenthesised kind, and a
   * dash before what is claimed about it. Anchored on that shape rather than
   * on `- **`, which would exempt a hand-written `- **Note:** 43 spells are
   * blocked` — prose with a falsifiable count in it, wearing a bullet.
   */
  const GENERATED = /^- \*\*.+\*\* \(.+\) — /;

  const proseIntegers = (text: string): readonly string[] =>
    text
      .split('\n')
      .filter((line) => !line.startsWith('|') && !GENERATED.test(line))
      // A version needs two dots. `\d+(?:\.\d+)+` would take a percentage
      // with it, and `render` builds percentages — they are inside rows
      // today, and an exemption that survives being moved into a sentence is
      // not an exemption.
      .map((line) => line.replace(/\d+(?:\.\d+){2,}/g, ' ').replace(/\+\d+/g, ' '))
      .flatMap((line) => line.match(/\d+/g) ?? []);

  it('says so about the committed report', () => {
    expect(proseIntegers(readFileSync(REPORT, 'utf8'))).toEqual([]);
  });

  it('says so about the report the script would write next', () => {
    expect(proseIntegers(renderReport())).toEqual([]);
  });

  /** And the reading bites: a count smuggled into a sentence is caught. */
  it('would catch a count written into a sentence', () => {
    expect(proseIntegers('The engine executes 84 spells.\n| 84 |\n- **X** (level 3) — ok\n')).toEqual(
      ['84'],
    );
  });

  /** A percentage in a sentence is a count, and only a version is exempt. */
  it('would catch a percentage written into a sentence', () => {
    expect(proseIntegers('The engine executes 29.2% of spells.\n')).toEqual(['29', '2']);
    expect(proseIntegers('# SRD 5.2.1 coverage\n')).toEqual([]);
  });

  /** A bullet is exempt because it is generated, not because it is a bullet. */
  it('would catch a count in a hand-written bullet', () => {
    expect(proseIntegers('- **Note:** 43 spells are blocked\n')).toEqual(['43']);
    expect(proseIntegers('- **Fireball** (level 3) — verified\n')).toEqual([]);
  });
});
