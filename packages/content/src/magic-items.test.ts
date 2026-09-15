import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMagicItems, type MagicItem, type MagicItemCategory } from '@ie/srd';
import {
  ITEM_EFFECT_KINDS,
  REQUIREMENT_KINDS,
  checkContent,
  type CatalogueItem,
} from '@ie/engine';
import { normaliseProse, quotedRunsIn } from '../scripts/citations.js';
import { SRD_ITEMS, SRD_MAGIC_ITEMS } from './items.js';
import { SRD_CLASSES, SRD_CONTENT_INPUT } from './index.js';

/**
 * The transcription guard: every magic item in the catalogue, held against the
 * entry `@ie/srd` parses out of `raw/magic-items.md`.
 *
 * **Against the book, not against a second list.** A test that repeated the
 * rarities and prerequisites by hand would agree with a typo as happily as
 * with the truth — the failure mode a transcription has, and the one the
 * species task hit. The parser reads all 258 entries with a name, a category,
 * a rarity line, an attunement bracket, a prerequisite and a charge count, so
 * each of those is checked against the page rather than against a copy of it.
 *
 * What the catalogue does **not** carry is rarity and category as fields: a
 * `CatalogueItem` has a kind and a grant, and rarity is not a mechanic. So the
 * two are checked through what they decide — the kind against the category the
 * book files the item under, and the rarity through the number the rarity
 * picks, which is the qualifier the book prints beside it ("Rare (+2)").
 */

const RAW = readFileSync(
  fileURLToPath(new URL('../../srd/raw/magic-items.md', import.meta.url)),
  'utf8',
);
const PARSED = parseMagicItems(RAW, 'magic-items.md');

/** The analysis is not vacuous: the parse that everything below reads worked. */
it('reads the book the catalogue was transcribed from', () => {
  expect(PARSED.problems).toEqual([]);
  expect(PARSED.items).toHaveLength(258);
});

const BY_NAME = new Map(PARSED.items.map((entry) => [entry.name, entry]));

/**
 * The three entries the SRD writes as a template over an equipment table, and
 * the one it writes over half of one.
 *
 * A catalogue item is one *instance* of such an entry — a +2 Rapier, a Mithral
 * Breastplate — and its name is therefore not the entry's. This is the whole
 * of the hand-written link between the two, and it is deliberately the only
 * thing hand-written here: everything else about the instance is read off the
 * entry it resolves to, so a mistyped rarity or a forgotten attunement bracket
 * fails rather than agreeing with itself.
 */
const FAMILY: readonly {
  readonly entry: string;
  readonly matches: (item: CatalogueItem) => boolean;
}[] = [
  {
    entry: 'Weapon, +1, +2, or +3',
    matches: (item) => /^\+[123] /.test(item.name) && item.weapon !== null,
  },
  {
    entry: 'Shield, +1, +2, or +3',
    matches: (item) => /^\+[123] /.test(item.name) && item.armor?.category === 'shield',
  },
  {
    entry: 'Armor, +1, +2, or +3',
    matches: (item) => /^\+[123] /.test(item.name) && item.armor !== null,
  },
  { entry: 'Mithral Armor', matches: (item) => item.name.startsWith('Mithral ') },
];

const entryOf = (item: CatalogueItem): MagicItem => {
  const named = BY_NAME.get(item.name);
  if (named !== undefined) return named;
  const family = FAMILY.find((template) => template.matches(item));
  const entry = family === undefined ? undefined : BY_NAME.get(family.entry);
  if (entry === undefined) {
    throw new Error(`${item.name} resolves to no entry in the SRD's magic items`);
  }
  return entry;
};

/** The Magic Item Categories table, against the kinds `ItemKind` has. */
const KIND_OF: Readonly<Record<MagicItemCategory, CatalogueItem['kind']>> = {
  Armor: 'armor',
  Potions: 'potion',
  Rings: 'ring',
  Rods: 'rod',
  Scrolls: 'scroll',
  Staffs: 'staff',
  Wands: 'wand',
  Weapons: 'weapon',
  'Wondrous Items': 'wondrous',
};

/**
 * "Requires Attunement by a Druid, Sorcerer, Warlock, or Wizard", as the
 * catalogue writes it.
 *
 * The book's own punctuation: a comma-separated list with "or" before the
 * last, and an article before each. What comes back is lowercased, which is
 * what a class id is — and the class ids are then held against the catalogue's
 * own classes, so "by a Paladin" transcribed as `paladins` fails here as well
 * as in `checkContent`.
 */
const prerequisiteClasses = (printed: string): readonly string[] =>
  printed
    .replace(/^by\s+(?:an?\s+)?/i, '')
    .split(/\s*,\s*|\s+or\s+/i)
    // "by a Bard, Cleric, or Druid": the Oxford comma leaves an "or" on the
    // last part, and every part but the first may carry an article of its own.
    .map((part) => part.replace(/^(?:or\s+)?(?:an?\s+)?/i, '').trim().toLowerCase())
    .filter((part) => part.length > 0);

/** The elision-aware containment `containsRun` does, over a string in hand. */
const contains = (text: string, run: string): boolean => {
  const haystack = normaliseProse(text);
  let cursor = 0;
  for (const part of run.split(/\s*(?:\.\.\.|…)\s*/)) {
    const fragment = normaliseProse(part);
    if (fragment.length === 0) continue;
    const at = haystack.indexOf(fragment, cursor);
    if (at < 0) return false;
    cursor = at + fragment.length;
  }
  return true;
};

const each = (): readonly (readonly [CatalogueItem, MagicItem])[] =>
  SRD_MAGIC_ITEMS.map((item) => [item, entryOf(item)] as const);

describe('every transcribed item agrees with the entry it was read from', () => {
  it('resolves every one of them to an entry the parser found', () => {
    // Not vacuous, and not a handful either: the guard below runs on all of
    // them, and the number is a consequence of the tables rather than a target.
    expect(SRD_MAGIC_ITEMS.length).toBeGreaterThan(150);
    for (const [item, entry] of each()) {
      expect(entry.name, item.id).toBeTruthy();
    }
  });

  it('files each under the kind the book files its category under', () => {
    for (const [item, entry] of each()) {
      expect(item.kind, `${item.id} is filed under ${entry.category}`).toBe(
        KIND_OF[entry.category],
      );
    }
  });

  /**
   * The bracket on the type line, in both directions: an item the book says
   * requires attunement carries an `attunement` record, and one it does not
   * carries none. Presence is the requirement, so `{}` is the complete and
   * common answer.
   */
  it('requires attunement exactly where the book prints the bracket', () => {
    for (const [item, entry] of each()) {
      expect(item.attunement !== undefined, `${item.id}: ${entry.rarity.text}`).toBe(
        entry.requiresAttunement,
      );
    }
  });

  it('asks of whoever attunes exactly what the book asks', () => {
    const classIds = new Set(SRD_CLASSES.map((klass) => klass.id));
    for (const [item, entry] of each()) {
      const printed = entry.attunementPrerequisite;
      const attunement = item.attunement;
      if (printed === null) {
        expect(attunement?.byClass, item.id).toBeUndefined();
        expect(attunement?.bySpellcaster, item.id).toBeUndefined();
        continue;
      }
      const wanted = prerequisiteClasses(printed);
      if (wanted.join(' ') === 'spellcaster') {
        expect(attunement?.bySpellcaster, item.id).toBe(true);
        expect(attunement?.byClass, item.id).toBeUndefined();
        continue;
      }
      expect(attunement?.byClass, `${item.id} requires attunement ${printed}`).toEqual(wanted);
      for (const named of wanted) expect(classIds.has(named), `${item.id}: ${named}`).toBe(true);
    }
  });

  /**
   * **The bracket is a requirement, not a label**, and this is the sweep that
   * says so for every item at once rather than for the one a behaviour test
   * happens to pick up.
   *
   * Seven magic weapons shipped without it in the first draft of this
   * transcription: a weapon has no "while you wear this" clause, so the
   * grants declared none at all — and a character who picks a bracketed sword
   * up is *equipped*, which is enough for `itemStandingOf` to offer the grant.
   * The attunement the SRD asks for was never asked about. One test caught one
   * of the seven; this catches any of them, and anything transcribed after
   * them, because it reads the bracket off the page.
   */
  it('makes every benefit the book brackets wait for the attunement', () => {
    for (const [item, entry] of each()) {
      if (!entry.requiresAttunement) continue;
      for (const grant of item.grants ?? []) {
        if (grant.kind !== 'standing') continue;
        expect(
          (grant.requires ?? []).some((requirement) => requirement.kind === 'while-attuned'),
          `${item.id}: the book prints "(Requires Attunement)" and this grant does not ask`,
        ).toBe(true);
      }
    }
  });

  /**
   * Rarity, through the one thing it decides.
   *
   * "Uncommon (+1), Rare (+2), or Very Rare (+3)" is the book saying which
   * number a given copy of the item carries, so a +2 Rapier is checked against
   * the option whose qualifier is "+2" — if the book ever stopped offering a
   * +2 of that entry, the instance would have nothing to resolve to.
   */
  it('gives a "+N" instance the number the rarity beside it names', () => {
    const plussed = SRD_MAGIC_ITEMS.filter((item) => /^\+[123] /.test(item.name));
    expect(plussed.length).toBeGreaterThan(100);

    for (const item of plussed) {
      const entry = entryOf(item);
      const plus = Number(item.name[1]);
      const option = entry.rarity.options.find((one) => one.qualifier === `+${plus}`);
      expect(option?.rarity, `${item.id} against "${entry.rarity.text}"`).toBeTruthy();

      const grant = item.grants?.[0];
      if (grant?.kind !== 'standing') throw new Error(`${item.id} grants nothing standing`);
      expect(grant.effects?.[0], item.id).toMatchObject({ kind: 'flat-bonus', flat: plus });
    }
  });

  /**
   * The charge count, and the die that refills it, read off the entry's own
   * prose rather than recalled — "This wand has 7 charges" is a number the
   * parser already extracts, and the regain line is quoted back at the page.
   */
  it('sizes a charge pool as the item’s own line sizes it', () => {
    for (const [item, entry] of each()) {
      const pool = item.grants?.find((grant) => grant.kind === 'pool');
      if (pool === undefined) continue;
      if (pool.kind !== 'pool') throw new Error('unreachable');

      expect(entry.charges?.maximum, `${item.id} declares charges the book does not`).toBe(
        pool.uses,
      );
      expect(pool.recovers, item.id).toBe('dawn');
      const regain =
        pool.regainsAtDawn === undefined
          ? 'regain all expended charges daily at dawn'
          : `regains ${pool.regainsAtDawn} expended charges daily at dawn`;
      expect(contains(entry.description, regain), `${item.id}: "${regain}"`).toBe(true);
    }
  });
});

describe('what an item does not do is data, and quotes the page', () => {
  const declared = SRD_MAGIC_ITEMS.filter((item) => item.unmodelled !== undefined);

  it('is carried by the partial transcriptions and by nothing else', () => {
    expect(declared.length).toBeGreaterThan(15);
    for (const item of declared) {
      // A record with nothing but notes would be an item that grants nothing
      // and looks transcribed; those are left out of the catalogue entirely.
      expect(item.grants ?? [], `${item.id} declares gaps and executes nothing`).not.toEqual([]);
    }
    // The whole of what the book says, for the items that say only what the
    // engine can do: a +2 Rapier, a Mithral Breastplate, a Sentinel Shield.
    for (const id of ['rapier-plus-2', 'mithral-breastplate', 'sentinel-shield', 'stone-of-good-luck']) {
      expect(SRD_ITEMS.find((item) => item.id === id)?.unmodelled, id).toBeUndefined();
    }
  });

  it('is prose, and never an empty note', () => {
    for (const item of declared) {
      for (const [index, note] of (item.unmodelled ?? []).entries()) {
        expect(typeof note, `${item.id}[${index}]`).toBe('string');
        expect(note.trim().length, `${item.id}[${index}]`).toBeGreaterThan(20);
      }
    }
  });

  /**
   * **Every quotation is held against the entry it belongs to.** A note is a
   * claim about what the book says, and a claim nobody checks is how a clause
   * comes to be paraphrased into a different rule — the failure the spell
   * corpus already has a guard for, pointed here at the item's own paragraph.
   */
  it('quotes the item’s own entry and no other', () => {
    const misquoted: string[] = [];
    for (const item of declared) {
      const entry = entryOf(item);
      for (const note of item.unmodelled ?? []) {
        for (const { run } of quotedRunsIn(note)) {
          if (contains(entry.description, run)) continue;
          misquoted.push(`${item.id} attributes to ${entry.name} a run it does not contain: "${run}"`);
        }
      }
    }
    expect(misquoted).toEqual([]);
  });

  /** The guard bites: a run the entry does not contain is reported. */
  it('would catch a note that quoted something the page does not say', () => {
    const cloak = SRD_MAGIC_ITEMS.find((item) => item.id === 'cloak-of-elvenkind');
    const entry = entryOf(cloak!);
    expect(contains(entry.description, 'Wisdom (Perception) checks made to perceive you')).toBe(
      true,
    );
    expect(contains(entry.description, 'Wisdom (Perception) checks made to smell you')).toBe(false);
  });
});

describe('nothing in the catalogue asks for a reader that does not exist', () => {
  it('grants only what an item’s two readers read', () => {
    for (const item of SRD_MAGIC_ITEMS) {
      for (const grant of item.grants ?? []) {
        expect(['standing', 'pool'], item.id).toContain(grant.kind);
        if (grant.kind !== 'standing') continue;
        for (const effect of grant.effects ?? []) {
          expect([...ITEM_EFFECT_KINDS], `${item.id}: ${effect.kind}`).toContain(effect.kind);
        }
        for (const requirement of grant.requires ?? []) {
          expect([...REQUIREMENT_KINDS], `${item.id}: ${requirement.kind}`).toContain(
            requirement.kind,
          );
        }
      }
    }
  });

  /**
   * And the one gate agrees. `checkContent` is what a homebrew catalogue
   * passes through, and the SRD's own has no privileged path: every id
   * unique, every charge key its own, every class a prerequisite names held.
   */
  it('passes the door every catalogue passes through', () => {
    expect(checkContent(SRD_CONTENT_INPUT)).toEqual([]);
  });
});
