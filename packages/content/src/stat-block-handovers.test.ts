/**
 * **A stat block's filed handovers, held to the rules a spell's are** — W7-B13.
 *
 * A stat-block sentence the parser reads and files as the table's
 * (`forTheTable`, on a save, a hit, a trait or a whole line) goes out under the
 * engine's handover mark and is counted by the ledger as finished business.
 * That is a claim a reviewer has to be able to check, so it is held here the
 * way `dm-handover.test.ts` holds a spell's `dmDecides`:
 *
 * - **every filed kind has a written reason**, and the list of reasons is the
 *   schema's list — `HANDOVER_LINE_KINDS` for the new ones, `HANDOVER_TRAIT_KINDS`
 *   for the world family the swarms reuse;
 * - **no filed kind is named in the engine**, the inverted pin a handover kind
 *   has always had: a kind with a reader is a mislabelled debt;
 * - **no filed sentence names a mechanic** unless `ARGUED_FILINGS` argues it,
 *   and every argument there is used;
 * - **every filed sentence is the book's own words**, and none is also owed.
 *
 * And Part 3's claim beside them: `LINE_RESIDUE_SEAMS` says it names every
 * Action and Bonus Action line at CR ≤ 5 that no enumerated shape names, and
 * the traits in the ledger's residue are each given a seam in
 * `HANDOVER_TRAIT_KINDS`' own note. Both were prose claims; both are asserted.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { PrintedHandoverKindSchema } from '@ie/srd/schemas';
import {
  ARGUED_FILINGS,
  HANDOVER_LINE_KINDS,
  HANDOVER_TRAIT_KINDS,
  LINE_RESIDUE_SEAMS,
  filedHandoversOf,
  statBlockLines,
} from '../scripts/coverage-data.js';
import { mechanicalMarkersIn } from '../scripts/missing-shapes.js';
import { auditLedger } from '../scripts/ledger.js';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Every filed sentence in the catalogue, with where it was filed. */
const FILED = SRD_CONTENT.monsters.flatMap((monster) =>
  statBlockLines(monster).flatMap((line) =>
    filedHandoversOf(line).map((one) => ({
      where: `${monster.id}/${line.name}`,
      text: line.text,
      kind: one.kind,
      sentence: one.sentence,
      line,
    })),
  ),
);

describe('the reasons a stat-block sentence may be filed', () => {
  it('files something, so the checks below read something', () => {
    expect(FILED.length).toBeGreaterThan(20);
  });

  it('gives every kind the schema admits a written reason, and no reason to a kind it does not', () => {
    const kinds: readonly string[] = PrintedHandoverKindSchema.options;
    const argued = (kind: string): boolean =>
      Object.hasOwn(HANDOVER_LINE_KINDS, kind) || Object.hasOwn(HANDOVER_TRAIT_KINDS, kind);
    expect(kinds.filter((kind) => !argued(kind))).toEqual([]);
    expect(Object.keys(HANDOVER_LINE_KINDS).filter((kind) => !kinds.includes(kind))).toEqual([]);
    // A reason somebody can act on, which is the bar the trait kinds set.
    for (const [kind, reason] of Object.entries(HANDOVER_LINE_KINDS)) {
      expect(reason.length, kind).toBeGreaterThan(120);
    }
    // And every kind the catalogue files under is one of them.
    expect(FILED.filter((one) => !kinds.includes(one.kind))).toEqual([]);
  });

  it('names no filed kind in the engine, because a kind with a reader is a debt', () => {
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
    expect(PrintedHandoverKindSchema.options.filter((kind) => text.includes(`'${kind}'`))).toEqual(
      [],
    );
  });
});

describe('a filed sentence is the table’s and says so in the book’s words', () => {
  it('names no mechanic, unless the map argues why the sentence is the table’s anyway', () => {
    const unargued = FILED.filter(
      (one) =>
        mechanicalMarkersIn(one.sentence).length > 0 &&
        !Object.keys(ARGUED_FILINGS).some((phrase) => one.sentence.includes(phrase)),
    ).map(
      (one) => `${one.where}: ${mechanicalMarkersIn(one.sentence).join(', ')} — "${one.sentence}"`,
    );
    expect(unargued).toEqual([]);
  });

  /**
   * **And the escape is not free**: every argument is used, and used by a
   * sentence a marker really does see. An argument with no consumer is a
   * licence granted to nothing.
   */
  it('uses every argument, each on a sentence a marker fires on', () => {
    for (const [phrase, argument] of Object.entries(ARGUED_FILINGS)) {
      expect(argument.length, phrase).toBeGreaterThan(60);
      const users = FILED.filter((one) => one.sentence.includes(phrase));
      expect(users.length, phrase).toBeGreaterThan(0);
      for (const one of users) {
        expect(mechanicalMarkersIn(one.sentence).length, `${one.where}: ${phrase}`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it('files only the book’s own words, and never a sentence it also carries as owed', () => {
    const flat = (text: string): string =>
      text
        .replace(/\s*<br>\s*/g, ' ')
        .replace(/&emsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .toLowerCase();
    for (const one of FILED) {
      expect(flat(one.text), one.where).toContain(one.sentence.replace(/\.$/, '').toLowerCase());
      const line = one.line as {
        readonly save?: { readonly handedOver?: readonly string[] };
        readonly trait?: { readonly handedOver?: readonly string[] };
        readonly attack?: {
          readonly rider?: string | null;
          readonly riderSave?: { readonly handedOver?: readonly string[] };
        };
      };
      const owed = [
        ...(line.save?.handedOver ?? []),
        ...(line.trait?.handedOver ?? []),
        ...(line.attack?.riderSave?.handedOver ?? []),
      ];
      expect(owed, one.where).not.toContain(one.sentence);
      // A rider's filing is lifted off the rider, not left in it.
      expect(line.attack?.rider ?? '', one.where).not.toContain(one.sentence);
    }
  });
});

describe('the residue, named with its seams', () => {
  const ledger = auditLedger();

  /**
   * `LINE_RESIDUE_SEAMS` claims every Action and Bonus Action line at CR ≤ 5
   * that no enumerated shape names has an entry. The dossier found three it
   * did not; this is the claim, asserted, so a fourth fails here.
   */
  it('names every Action and Bonus Action line the ledger’s residue lists', () => {
    const lines = ledger.monsters.residue.filter(
      (one) => one.section === 'action' || one.section === 'bonus action',
    );
    // **Empty since wave M**, with `LINE_RESIDUE_SEAMS` beside it; the walk
    // stays so a line that joins the residue is named in the same commit.
    expect(lines).toEqual([]);
    const unnamed = lines
      .map((one) => {
        const block = SRD_CONTENT.monsters.find((monster) => monster.name === one.monster)!;
        return `${block.id}/${one.line}`;
      })
      .filter((key) => !Object.hasOwn(LINE_RESIDUE_SEAMS, key));
    expect(unnamed).toEqual([]);
  });

  /**
   * And the traits: `LINE_RESIDUE_SEAMS` says "a trait's residue is the table
   * in `HANDOVER_TRAIT_KINDS`' own note". A note is prose, so this reads it —
   * every trait the residue lists is named in the table, by its heading.
   */
  it('gives every trait the ledger’s residue lists a row in the handover kinds’ own note', () => {
    const source = readFileSync(`${here}../scripts/coverage-data.ts`, 'utf8');
    const start = source.indexOf(
      '**What is deliberately *not* here is the other half of the residue**',
    );
    const end = source.indexOf('export const HANDOVER_TRAIT_KINDS');
    expect(start).toBeGreaterThan(0);
    const note = source.slice(start, end);
    // **Empty since M-RISE**, when the Otherworldly Steed's Life Bond — the last
    // trait the residue listed — was built. The walk stays, so a trait that
    // joins the residue must be named in the note in the same commit.
    const traits = ledger.monsters.residue.filter((one) => one.section === 'trait');
    const unnamed = traits
      .filter((one) => !note.includes(one.line))
      .map((one) => `${one.monster}/${one.line}`);
    expect(unnamed).toEqual([]);
  });
});
