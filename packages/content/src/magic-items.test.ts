import { describe, expect, it } from 'vitest';
import { ITEM_EFFECT_KINDS, REQUIREMENT_KINDS, checkContent } from '@ie/engine';
import { normaliseProse, quotedRunsIn } from '../scripts/citations.js';
import {
  MAGIC_ITEM_KIND_OF,
  entryFor,
  magicItemParse,
  transcribedItems,
} from '../scripts/magic-items.js';
import { SRD_ITEMS, SRD_MAGIC_ITEMS } from './items.js';
import { SPELL_DEFINITIONS as SRD_SPELLS } from './spells.js';
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
 *
 * **The join itself moved to `scripts/magic-items.ts`.** `COVERAGE.md` counts
 * entries as well as instances, and it must count them the way this guard
 * checks them — a second spelling of "which entry is this item" is the second
 * place to get it wrong, which is the record `coverage-data.ts`'s `isExecuted`
 * already carries.
 */

const PARSED = magicItemParse();

/** The analysis is not vacuous: the parse that everything below reads worked. */
it('reads the book the catalogue was transcribed from', () => {
  expect(PARSED.problems).toEqual([]);
  expect(PARSED.items).toHaveLength(258);
});

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

describe('every transcribed item agrees with the entry it was read from', () => {
  it('resolves every one of them to an entry the parser found', () => {
    // Not vacuous, and not a handful either: the guard below runs on all of
    // them, and the number is a consequence of the tables rather than a target.
    expect(SRD_MAGIC_ITEMS.length).toBeGreaterThan(150);
    for (const [item, entry] of transcribedItems()) {
      expect(entry.name, item.id).toBeTruthy();
    }
  });

  it('files each under the kind the book files its category under', () => {
    for (const [item, entry] of transcribedItems()) {
      expect(item.kind, `${item.id} is filed under ${entry.category}`).toBe(
        MAGIC_ITEM_KIND_OF[entry.category],
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
    for (const [item, entry] of transcribedItems()) {
      expect(item.attunement !== undefined, `${item.id}: ${entry.rarity.text}`).toBe(
        entry.requiresAttunement,
      );
    }
  });

  it('asks of whoever attunes exactly what the book asks', () => {
    const classIds = new Set(SRD_CLASSES.map((klass) => klass.id));
    for (const [item, entry] of transcribedItems()) {
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
    for (const [item, entry] of transcribedItems()) {
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
      const entry = entryFor(item);
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
    for (const [item, entry] of transcribedItems()) {
      const pool = item.grants?.find((grant) => grant.kind === 'pool');
      if (pool === undefined) continue;
      if (pool.kind !== 'pool') throw new Error('unreachable');

      // **A per-day property is a pool of one**, and the book prints it as a
      // sentence rather than as a charge count: "This property can't be used
      // again until the next dawn." It is the same mechanism with every number
      // set to one — one use, spent by the thing it buys, given back whole at
      // a declared dawn — so it is checked against the sentence the entry does
      // print rather than against a charge count it does not.
      if (entry.charges === null) {
        expect(pool.uses, `${item.id} has no charge count in the book`).toBe(1);
        expect(pool.regainsAtDawn, `${item.id} refills whole`).toBeUndefined();
        expect(
          contains(entry.description, "can't be used again until the next dawn"),
          `${item.id} declares a pool the entry prints nothing for`,
        ).toBe(true);
        expect(pool.recovers, item.id).toBe('dawn');
        continue;
      }

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

  /**
   * What a charge buys, held against the line that prices it.
   *
   * SRD "Spells Cast from Items" makes the casting itself the engine's
   * business; what is the *item's* is the spell, the price and — where the
   * entry prints one — the DC. All three are on the page, so all three are
   * checked against it rather than against a copy: a staff whose table says
   * three charges and whose grant says one would otherwise be a silently
   * cheaper staff, and a printed DC mistyped by one is a spell that has been
   * quietly made easier for ever.
   *
   * The spell is matched by the display name the book italicises rather than
   * by the catalogue slug, which is what the entry actually contains.
   */
  it('prices a spell it casts as the item’s own table prices it', () => {
    let checked = 0;
    for (const [item, entry] of transcribedItems()) {
      for (const grant of item.grants ?? []) {
        if (grant.kind !== 'casts') continue;
        checked += 1;
        const name = SRD_SPELLS.find((spell) => spell.id === grant.spell)?.name;
        expect(name, `${item.id} casts ${grant.spell}, which the catalogue does not define`)
          .toBeDefined();
        expect(
          contains(entry.description, name ?? grant.spell),
          `${item.id} casts ${name ?? grant.spell}, which its entry never names`,
        ).toBe(true);

        // The price, in each of the three ways the book prints one: written
        // out ("expend 1 charge to cast"), named as the floor of a range ("For
        // 1 charge, you cast the level 3 version"), or in a cell of a staff's
        // table beside the spell. An entry that prints no charge count at all
        // is a per-day property, which is a pool of one and priced by the
        // sentence that says so.
        //
        // And the fourth way, which is not a price: SRD Helm of Comprehending
        // Languages prints no charge count, no per-day sentence and no other
        // limit, so `atWill` is held against the *absence* of all three. An
        // entry that does print one of them would be an item quietly made
        // free, which is the mirror of a staff quietly made cheap.
        if (grant.atWill === true) {
          expect(grant.charges, `${item.id} casts ${name} at will and names a price`)
            .toBeUndefined();
          expect(entry.charges, `${item.id} casts ${name} at will and its entry has charges`)
            .toBeNull();
          expect(
            contains(entry.description, "can't be used again until the next dawn"),
            `${item.id} casts ${name} at will and its entry prints a per-day limit`,
          ).toBe(false);
        } else {
          const printed =
            entry.charges === null
              ? grant.charges === 1 &&
                contains(entry.description, "can't be used again until the next dawn")
              : contains(entry.description, `expend ${grant.charges} charge`) ||
                contains(entry.description, `For ${grant.charges} charge`) ||
                tablePrices(entry.description).get(name ?? '') === grant.charges;
          expect(printed, `${item.id} prices ${name} at ${grant.charges}, and its entry does not`)
            .toBe(true);
        }

        // SRD Ring of Jumping: "but can target only yourself when you do so."
        // A narrowing the item prints, and the words it prints it in.
        if (grant.targetsSelfOnly === true) {
          expect(
            contains(entry.description, 'only yourself'),
            `${item.id} narrows ${name} to its wearer and its entry does not say so`,
          ).toBe(true);
        }

        if (grant.saveDc !== undefined) {
          expect(
            contains(entry.description, `save DC ${grant.saveDc}`),
            `${item.id} prints a save DC of ${grant.saveDc} nowhere in its entry`,
          ).toBe(true);
        }
        if (grant.upToCharges !== undefined) {
          expect(
            contains(entry.description, `no more than ${grant.upToCharges} charges`),
            `${item.id} lets ${grant.upToCharges} charges go and its entry does not`,
          ).toBe(true);
        }
      }
    }
    // Not vacuous: the catalogue really does have items that cast.
    expect(checked).toBeGreaterThan(3);
  });
});

/**
 * The charge cost a staff's table prints beside each spell.
 *
 * The SRD writes these as an HTML table with the spell in one cell and the
 * cost in the next, and two spells to a row on the wider ones — so a single
 * regular expression over pairs reads both shapes, and a spell that is not in
 * a table simply is not in the map.
 */
const tablePrices = (description: string): ReadonlyMap<string, number> => {
  const prices = new Map<string, number>();
  const cells = [...description.matchAll(/<td>([^<]*)<\/td>/g)].map((m) => (m[1] ?? '').trim());
  for (let n = 0; n + 1 < cells.length; n += 2) {
    const spell = (cells[n] ?? '').replace(/[*_]/g, '').trim();
    const cost = Number((cells[n + 1] ?? '').trim());
    if (spell.length > 0 && Number.isInteger(cost)) prices.set(spell, cost);
  }
  return prices;
};

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
      const entry = entryFor(item);
      for (const note of item.unmodelled ?? []) {
        for (const { run } of quotedRunsIn(note)) {
          if (contains(entry.description, run)) continue;
          misquoted.push(`${item.id} attributes to ${entry.name} a run it does not contain: "${run}"`);
        }
      }
    }
    expect(misquoted).toEqual([]);
  });

  /**
   * The extra-damage tranche, both halves of it.
   *
   * `attack-damage` gained the narrowing `flat-bonus` already had — "this
   * magic weapon deals an extra 2d6 damage", and no other weapon does — and
   * what that finished is exactly the items whose extra die is unconditional
   * once it is tied to the object. An item whose die is conditional on *what
   * the target is* is not finished by it: "if the target is a Dragon" is a
   * test of the creature being hit, and nothing on the damage path reads one.
   *
   * Written down as data rather than left to the totals, because "which items
   * this shape finished" is the claim, and a count cannot be wrong in a way
   * anybody notices.
   */
  it('finishes the items whose extra die needed only the narrowing', () => {
    const complete = SRD_MAGIC_ITEMS.filter((item) => (item.unmodelled ?? []).length === 0);
    expect(complete.map((item) => item.id)).toContain('vicious-weapon');

    // Still partial, and each note says which clause is still the table's.
    const stillOwed: Readonly<Record<string, string>> = {
      'sword-of-wounding': 'Constitution saving throw',
      'frost-brand': 'extinguish all nonmagical flames',
      'dragon-slayer': 'if the target is a Dragon',
      'giant-slayer': 'When you hit a Giant',
      'holy-avenger': 'When you hit a Fiend or an Undead',
    };
    for (const [id, clause] of Object.entries(stillOwed)) {
      const item = SRD_MAGIC_ITEMS.find((one) => one.id === id);
      expect(item, id).toBeDefined();
      const notes = item?.unmodelled ?? [];
      expect(notes.length, `${id} says nothing about what it still owes`).toBeGreaterThan(0);
      expect(notes.some((note) => note.includes(clause)), `${id}: "${clause}"`).toBe(true);
    }
  });

  /** The guard bites: a run the entry does not contain is reported. */
  it('would catch a note that quoted something the page does not say', () => {
    const cloak = SRD_MAGIC_ITEMS.find((item) => item.id === 'cloak-of-elvenkind');
    const entry = entryFor(cloak!);
    expect(contains(entry.description, 'Wisdom (Perception) checks made to perceive you')).toBe(
      true,
    );
    expect(contains(entry.description, 'Wisdom (Perception) checks made to smell you')).toBe(false);
  });
});

describe('nothing in the catalogue asks for a reader that does not exist', () => {
  it('grants only what an item’s four readers read', () => {
    for (const item of SRD_MAGIC_ITEMS) {
      for (const grant of item.grants ?? []) {
        expect(['standing', 'pool', 'casts', 'confers'], item.id).toContain(grant.kind);
        // SRD's two sides of one sentence: a spell an item casts is judged
        // against the spell vocabulary by `checkContent`, and so is the effect
        // list it confers — see `CONFERRED_EFFECT_KINDS`. Only the `standing`
        // grant is read against the item-specific vocabularies below.
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
