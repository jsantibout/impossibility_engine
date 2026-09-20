import { readFileSync } from 'node:fs';
import { SPELL_DEFINITIONS, SRD_CONTENT, SRD_MAGIC_ITEMS } from '@ie/content';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SPELL_INDEX, spellById } from '@ie/srd';
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
} from '../scripts/coverage-data.js';
import { entryFor, isCompleteItem, magicItemEntries } from '../scripts/magic-items.js';
import { bestiaryRow, renderReport } from '../scripts/coverage.js';

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
   * And the second list is not a way out of the first: exactly one tracked
   * definition accounts for itself with a handover alone, and it is named here
   * so that a second one is a line somebody has to add rather than a silence.
   */
  it('names the one tracked spell whose whole text is the DM’s', () => {
    expect(tracked.filter((d) => (d.unmodelled ?? []).length === 0).map((d) => d.id)).toEqual([
      'legend-lore',
    ]);
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
      expect(definition!.unmodelled ?? [], id).not.toEqual([]);
    }
  });

  /**
   * **Partial and verified are two axes, not two values of one.**
   *
   * They were kept apart while `PARTIAL_SPELLS` held one spell that no test
   * drove end to end, and that reading does not survive the honesty guard
   * reaching the executed bucket: partial now means *a clause of this spell is
   * adjudicated to a missing shape*, and a spell can be driven end to end and
   * still leave one unbuilt. Web is exactly that — every save its webs call
   * for is raised and resolved, and crossing them costs the same as crossing
   * an empty floor. Rendering only the tick would be the green tick this third
   * state was invented to prevent, so the report says both.
   */
  it('lets a spell be driven end to end and still carry a debt', () => {
    const both = PARTIAL_SPELLS.filter((id) => VERIFIED_SPELLS.includes(id));
    expect(both.length).toBeGreaterThan(0);
    expect(both).toContain('web');
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
   */
  it('carries every parsed block into the catalogue, by id', () => {
    const parsed = JSON.parse(
      readFileSync('packages/srd/src/generated/monsters.json', 'utf8'),
    ) as readonly { readonly id: string }[];

    expect(bestiary.carried).toBe(SRD_CONTENT.monsters.length);
    expect(SRD_CONTENT.monsters.map((m) => m.id).sort()).toEqual(
      parsed.map((m) => m.id).sort(),
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
   * printed line is a name and the book's sentence, **plus** at most the two
   * fields a parser fills when it read that sentence — an attack's numbers or
   * a trait's mechanic. A third field would be a population the row is not
   * counting, so it fails here rather than quietly joining the *read* column.
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

    expect([...keys].sort()).toEqual(['attack', 'multiattack', 'name', 'text', 'trait']);
  });

  /**
   * *Read* is counted off the lines themselves, so it cannot drift from the
   * population it is a fraction of — and it is a fraction: a report claiming
   * more read lines than printed ones would be counting something else.
   */
  it('counts the read lines as a part of the printed ones', () => {
    const read = SRD_CONTENT.monsters.reduce(
      (sum, m) =>
        sum +
        [...m.traits, ...m.actions, ...m.bonusActions, ...m.reactions, ...m.legendaryActions].filter(
          (line) =>
            line.attack !== undefined ||
            line.trait !== undefined ||
            line.multiattack !== undefined,
        ).length,
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
   * Each shape must find something and must not find everything — a predicate
   * matching every block is a predicate that has stopped discriminating — and
   * the rows must be ranked, because the brief the table answers asked for a
   * ranking and an unsorted list quietly stops being one.
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
