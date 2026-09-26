import { describe, expect, it } from 'vitest';
import {
  ITEM_EFFECT_KINDS,
  REQUIREMENT_KINDS,
  type CatalogueItem,
  checkContent,
} from '@ie/engine';
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

/**
 * **A per-day property, in every wording the book gives it.**
 *
 * "This property can't be used again until the next dawn" is the sentence the
 * guards below were written against, and it is not the only one the book
 * prints: the Circlet of Blasting says "The circlet can't cast this spell
 * again until the next dawn", and the Crystal Ball of Telepathy says "You
 * can't cast _Suggestion_ in this way again until the next dawn" — beside a
 * Scrying it puts no limit on at all. What every one of them shares is the
 * last five words, so that is what is matched, and the *subject* of each
 * sentence is then what says which casting it limits.
 */
const DAWN_LIMIT = 'again until the next dawn';

/** The sentences of an entry that print a per-day limit. */
const dawnSentences = (description: string): readonly string[] =>
  description
    .split(/(?<=\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => contains(sentence, DAWN_LIMIT));

/**
 * **A per-rest property**, which is the per-day one with a Long Rest where the
 * dawn is. SRD Boots of Speed: "When you've used the boots' property for a
 * total of 10 minutes, the magic ceases to function for you **until you finish
 * a Long Rest**." The same pool of one, given back by the rest the page names
 * rather than by a declared morning.
 */
const REST_LIMIT = 'until you finish a Long Rest';

/** The sentences of an entry that print a per-rest limit. */
const restSentences = (description: string): readonly string[] =>
  description
    .split(/(?<=\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => contains(sentence, REST_LIMIT));

/**
 * **A use count with no morning behind it**, in the words the book gives it.
 *
 * Every charged item in the book but one prints a dawn line, and the Chime of
 * Opening is the one: "The chime can be used 10 times." A pool tagged `dawn`
 * with no dice beside it *refills*, so the difference between reading this
 * sentence and not reading it is ten strikes in a chime's life against ten
 * every morning — which is why the count is read off the page here rather
 * than believed off the record.
 */
const countedUses = (description: string): number | null => {
  const printed = /can be used (\d+) times/.exec(normaliseProse(description));
  return printed === null ? null : Number(printed[1]);
};

/**
 * The smallest a rolled count can come out, which is what a rolled pool's
 * `uses` may be and the only number about one that is not a guess.
 *
 * SRD writes the count as dice — "a container contains 1d6 + 1 ounces" — and
 * `awardItems` throws them at the copy's birth. The dice sit on the item's
 * pool grant, which is where `checkContent` can see them, and they are the
 * whole of the sizing: a pool that printed dice **and** a flat `uses` is
 * refused, so there is no placeholder to hold against them.
 */
const rolledPoolOf = (item: CatalogueItem): string | undefined => {
  const pool = (item.grants ?? []).find((grant) => grant.kind === 'pool');
  return pool?.kind === 'pool' ? pool.usesRolled : undefined;
};

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

      // **A count the book rolls at the copy's birth.** SRD Sovereign Glue
      // and Universal Solvent: "When found, a container contains 1d6 + 1
      // ounces." The dice live on the pool rather than on the item, which is
      // where the validator can see them, and they are the whole of the
      // sizing: a pool printing a rolled maximum **and** a flat `uses` is
      // refused, so there is no floor to hold them against. `awardItems`
      // throws the die once at the copy's birth and pins what it threw.
      if (pool.usesRolled !== undefined) {
        expect(
          contains(entry.description, pool.usesRolled),
          `${item.id} rolls "${pool.usesRolled}", which its entry never prints`,
        ).toBe(true);
        expect(
          entry.charges?.maximum ?? null,
          `${item.id} rolls its count and its entry prints one`,
        ).toBeNull();
        expect(pool.uses, `${item.id} sizes its pool once, and the dice are the sizing`).toBeUndefined();
        expect(pool.regainsAtDawn, item.id).toBeUndefined();
      } else if (entry.charges === null && countedUses(entry.description) !== null) {
        // **A count the book prints and never gives back**: "The chime can be
        // used 10 times." The one entry in the book with a charge economy and
        // no morning at all, and the tag is what keeps it that way.
        expect(pool.uses, `${item.id} counts what its entry counts`).toBe(
          countedUses(entry.description),
        );
        expect(pool.regainsAtDawn, item.id).toBeUndefined();
      } else if (entry.charges === null) {
        // **A per-day property is a pool of one**, and the book prints it as a
        // sentence rather than as a charge count: "This property can't be used
        // again until the next dawn." It is the same mechanism with every number
        // set to one — one use, spent by the thing it buys, given back whole at
        // a declared dawn — so it is checked against the sentence the entry does
        // print rather than against a charge count it does not.
        expect(pool.uses, `${item.id} has no charge count in the book`).toBe(1);
        expect(pool.regainsAtDawn, `${item.id} refills whole`).toBeUndefined();
        // Or a Long Rest where the morning is — see {@link REST_LIMIT}.
        expect(
          dawnSentences(entry.description).length + restSentences(entry.description).length,
          `${item.id} declares a pool the entry prints nothing for`,
        ).toBeGreaterThan(0);
      } else {
        expect(entry.charges?.maximum, `${item.id} declares charges the book does not`).toBe(
          pool.uses,
        );
        // SRD Rod of Resurrection prints its number in the singular — "regains
        // 1 expended charge daily at dawn" — and every other entry in the
        // plural, which is the same clause and not a second rule. And SRD
        // Winged Boots print the verb for a plural subject — "These boots have
        // 4 charges and regain 1d4 expended charges daily at dawn" — which is
        // the same clause again, agreeing with a pair of boots.
        const regain =
          pool.regainsAtDawn === undefined
            ? ['regain all expended charges daily at dawn']
            : [
                `regains ${pool.regainsAtDawn} expended charges daily at dawn`,
                `regains ${pool.regainsAtDawn} expended charge daily at dawn`,
                `regain ${pool.regainsAtDawn} expended charges daily at dawn`,
              ];
        expect(
          regain.some((printed) => contains(entry.description, printed)),
          `${item.id}: "${regain[0]}"`,
        ).toBe(true);
      }

      // **The recovery is the page's, in both directions.** A pool tagged
      // `dawn` with no dice refills whole, so an entry that prints no morning
      // and gets one is an item quietly refilled every day — the mirror of
      // the staff quietly made cheap below, and the reason `special` is a tag
      // that has to be checked rather than a default.
      //
      // **And a Long Rest is a third answer**, printed as "until you finish a
      // Long Rest" on an entry that prints no morning: a pool tagged `dawn`
      // there would come back at a declared dawn the book never mentions, and
      // one tagged `special` would never come back at all.
      const morning =
        contains(entry.description, 'daily at dawn') || dawnSentences(entry.description).length > 0;
      const rested = !morning && restSentences(entry.description).length > 0;
      expect(
        pool.recovers,
        `${item.id}: the entry ${morning ? 'prints' : 'prints no'} morning${rested ? ' and prints a Long Rest' : ''}`,
      ).toBe(morning ? 'dawn' : rested ? 'long-rest' : 'special');
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
        // **A per-day sentence may limit one casting and not another**, which
        // is the Crystal Ball of Telepathy: the book prints no limit at all on
        // its Scrying and a nightly one on its Suggestion. So a free casting
        // is held against the per-day sentences that could be about *it* —
        // one naming another spell the same item prices is somebody else's —
        // rather than against the presence of any such sentence anywhere.
        // **And one filed under another property is that property's**: SRD
        // Rod of Alertness's "Once used, this property can't be used again
        // until the next dawn" closes its _Protective Aura_, and its spells
        // are under _Spells._ — see {@link underAnotherProperty}.
        const limits = dawnSentences(entry.description).filter(
          (sentence) =>
            !underAnotherProperty(entry.description, sentence, name ?? grant.spell) &&
            !(item.grants ?? []).some(
              (other) =>
                other.kind === 'casts' &&
                other.atWill !== true &&
                other.spell !== grant.spell &&
                contains(sentence, SRD_SPELLS.find((s) => s.id === other.spell)?.name ?? ''),
            ),
        );
        if (grant.atWill === true) {
          expect(grant.charges, `${item.id} casts ${name} at will and names a price`)
            .toBeUndefined();
          // An entry with charges may still price one casting at nothing, in
          // the two ways {@link pricedAtNothing} reads; anywhere else a charge
          // count beside an at-will casting is a staff quietly made free.
          expect(
            entry.charges === null || pricedAtNothing(entry.description, name ?? grant.spell),
            `${item.id} casts ${name} at will and its entry has charges`,
          ).toBe(true);
          expect(
            limits,
            `${item.id} casts ${name} at will and its entry prints a per-day limit`,
          ).toEqual([]);
        } else {
          const printed =
            entry.charges === null
              ? // A per-day sentence, or a count of things the entry says you
                // spend one of — a strike of a chime, an ounce out of a jar.
                // Either way the price is one, because a page that charged
                // more would have printed a number to charge it in.
                grant.charges === 1 &&
                (limits.length > 0 ||
                  countedUses(entry.description) !== null ||
                  rolledPoolOf(item) !== undefined)
              : // The three ways the book writes a price: written out, named
                // as the floor of a range, or parenthesised beside the spell —
                // SRD Rod of Resurrection's "(expends 1 charge)", and Cubic
                // Gate's "expend 1 of the cube's charges", which is the same
                // clause with the possessive in the way.
                contains(entry.description, `expend ${grant.charges} charge`) ||
                contains(entry.description, `expends ${grant.charges} charge`) ||
                contains(entry.description, `expend ${grant.charges} of the`) ||
                contains(entry.description, `For ${grant.charges} charge`) ||
                tablePrices(entry.description).get(name ?? '') === grant.charges ||
                // And a cell that prices by the level — see {@link perLevelCells}
                // — where the floor is one charge for each level of the spell.
                (perLevelCells(entry.description).has(name ?? '') &&
                  grant.charges === SRD_SPELLS.find((spell) => spell.id === grant.spell)?.level);
          expect(printed, `${item.id} prices ${name} at ${grant.charges}, and its entry does not`)
            .toBe(true);
        }

        // A narrowing the item prints, in the two wordings the book gives it:
        // SRD Ring of Jumping's "but can target only yourself when you do so"
        // and SRD Boots of Levitation's "you can cast _Levitate_ on
        // yourself", which is the same clause said once instead of twice.
        if (grant.targetsSelfOnly === true) {
          expect(
            ['only yourself', `${name} on yourself`].some((said) =>
              contains(entry.description, said),
            ),
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
          // Two wordings: the wands' "no more than 3 charges", and SRD Eyes of
          // Charming's "1 or more charges", whose only ceiling is the charges
          // the lenses hold — so the maximum it may name is the pool's size
          // and nothing else.
          const poolSize = (item.grants ?? []).find((one) => one.kind === 'pool');
          // And a third: SRD Staff of Healing's "(maximum 4 for a level 4
          // spell)", whose ceiling is printed in the cell that prices the row.
          expect(
            contains(entry.description, `no more than ${grant.upToCharges} charges`) ||
              (contains(entry.description, `${grant.charges ?? 1} or more charges`) &&
                poolSize !== undefined &&
                'uses' in poolSize &&
                poolSize.uses === grant.upToCharges) ||
              perLevelCells(entry.description).get(name ?? '') === grant.upToCharges,
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
    if (spell.length === 0 || !Number.isInteger(cost)) continue;
    prices.set(spell, cost);
    // **A cell may annotate the spell it prices**, and the annotation is not
    // part of the name: SRD Wand of Fear prints "*Command* (flee or grovel
    // only)" and "*Fear* (60-foot Cone)", and the Staff of Power prints
    // "*Fireball* (level 5 version)". What the row is pricing is the spell
    // before the bracket, so the bracket is indexed away — and it is indexed
    // *as well as* the whole cell rather than instead of it, so a spell whose
    // printed name really contains a parenthesis is still found.
    const annotated = /^(.*?)\s*\([^()]*\)$/.exec(spell);
    if (annotated !== null) prices.set((annotated[1] ?? '').trim(), cost);
  }
  return prices;
};

/** The cells of an entry's table, in order, with the markup left on. */
const tableCells = (description: string): readonly string[] =>
  [...description.matchAll(/<td>([^<]*)<\/td>/g)].map((m) => (m[1] ?? '').trim());

/**
 * **A cell that prices a row by the level**, and the ceiling it prints.
 *
 * SRD Staff of Healing: "_Cure Wounds_ | 1 charge per spell level (maximum 4
 * for a level 4 spell)". That is the wands' sentence read from the other end —
 * one charge buys the spell's own level and each further charge one level more
 * — so the grant is a floor and an `upToCharges`, and this reads both off the
 * cell: the floor is one charge per level of the spell, the ceiling is the
 * printed maximum. Only the one wording, with the level and the maximum the
 * same number, because that is the only form in which the engine's arithmetic
 * ("one more level for each additional charge") is the book's.
 */
const perLevelCells = (description: string): ReadonlyMap<string, number> => {
  const found = new Map<string, number>();
  const cells = tableCells(description);
  for (let n = 0; n + 1 < cells.length; n += 2) {
    const printed = /^1 charge per spell level \(maximum (\d+) for a level \1 spell\)$/.exec(
      cells[n + 1] ?? '',
    );
    if (printed === null) continue;
    found.set((cells[n] ?? '').replace(/[*_]/g, '').trim(), Number(printed[1]));
  }
  return found;
};

/**
 * **An entry with charges that prices one of its castings at nothing**, in the
 * two ways the book prints it.
 *
 * - **A "0" in the table.** SRD Staff of the Magi prices Detect Magic, Light
 *   and three others at "0" in a staff of fifty charges — a cell that says the
 *   casting costs nothing, which is `atWill` and not a price of zero.
 * - **A sentence that names the spell and no charge.** SRD Ring of Shooting
 *   Stars: "You can cast _Dancing Lights_ or _Light_ from the ring. The ring has
 *   6 charges ... You can expend its charges to use the properties below." The
 *   cantrips are named before the charges are mentioned and in a sentence that
 *   prices nothing.
 *
 * The second is read strictly: every sentence that italicises the spell's name
 * must be free of the word "charge", so a spell priced anywhere in its own
 * entry is never free. A table row that prices it at more than nothing settles
 * it the other way before any sentence is read.
 */
const pricedAtNothing = (description: string, name: string): boolean => {
  const cell = tablePrices(description).get(name);
  if (cell !== undefined) return cell === 0;
  const naming = description
    .split(/(?<=\.)\s+/)
    .filter((sentence) => [`_${name}_`, `*${name}*`].some((mark) => sentence.includes(mark)));
  return naming.length > 0 && naming.every((sentence) => !/\bcharges?\b/i.test(sentence));
};

/**
 * The property heading each paragraph of an entry sits under.
 *
 * The book writes a many-property item as paragraphs each opening on its name
 * — "_Alertness._", "**_Faerie Fire._**", "**Cast Spell.**" — and a paragraph
 * with no heading of its own (a list of spells, a sentence continuing the
 * property above it) belongs to the one before. Null before the first.
 */
const headedParagraphs = (
  description: string,
): readonly { readonly heading: string | null; readonly text: string }[] => {
  let heading: string | null = null;
  return description.split(/\n\s*\n/).map((text) => {
    const opened = /^(?:\*\*_|\*\*|_)([^*_]+?)\.(?:_\*\*|\*\*|_)/.exec(text.trim());
    if (opened !== null) heading = opened[1] ?? null;
    return { heading, text };
  });
};

/**
 * **Is this per-day sentence filed under a property the spell is not?**
 *
 * "Once used, this property can't be used again until the next dawn" limits
 * *this property*, and which one that is the page says by where the sentence
 * stands. So a sentence under a heading is somebody else's limit when every
 * paragraph that italicises the spell sits under a different heading — and
 * nobody's verdict at all (false) where either is unheaded, which leaves the
 * guard exactly as strict as it was on every entry that does not head its
 * properties.
 */
const underAnotherProperty = (description: string, sentence: string, name: string): boolean => {
  const paragraphs = headedParagraphs(description);
  const at =
    paragraphs.find((one) => normaliseProse(one.text).includes(normaliseProse(sentence)))
      ?.heading ?? null;
  if (at === null) return false;
  const spells = paragraphs
    .filter((one) => [`_${name}_`, `*${name}*`].some((mark) => one.text.includes(mark)))
    .map((one) => one.heading);
  return spells.length > 0 && spells.every((heading) => heading !== null && heading !== at);
};

describe('the two ways a charged entry prices a casting at nothing, and the level-priced cell', () => {
  const magi = entryFor(SRD_MAGIC_ITEMS.find((item) => item.id === 'staff-of-the-magi')!);
  const ring = entryFor(SRD_MAGIC_ITEMS.find((item) => item.id === 'ring-of-shooting-stars')!);
  const healing = entryFor(SRD_MAGIC_ITEMS.find((item) => item.id === 'staff-of-healing')!);

  it('reads a "0" cell as free and every other cell as a price', () => {
    expect(pricedAtNothing(magi.description, 'Detect Magic')).toBe(true);
    expect(pricedAtNothing(magi.description, 'Light')).toBe(true);
    expect(pricedAtNothing(magi.description, 'Web')).toBe(false);
    expect(pricedAtNothing(magi.description, 'Fireball')).toBe(false);
  });

  it('reads a sentence that names no charge as free, and one that names a charge as not', () => {
    expect(pricedAtNothing(ring.description, 'Dancing Lights')).toBe(true);
    expect(pricedAtNothing(ring.description, 'Light')).toBe(true);
    expect(pricedAtNothing(ring.description, 'Faerie Fire')).toBe(false);
    // A spell the entry never italicises is never free.
    expect(pricedAtNothing(ring.description, 'Fireball')).toBe(false);
  });

  it('reads the Staff of Healing’s cell as a ceiling of 4 on Cure Wounds and nothing else', () => {
    expect([...perLevelCells(healing.description)]).toEqual([['Cure Wounds', 4]]);
    expect(perLevelCells(magi.description).size).toBe(0);
  });

  it('files a per-day sentence under the property it closes, and a spell under its own', () => {
    const rod = entryFor(SRD_MAGIC_ITEMS.find((item) => item.id === 'rod-of-alertness')!);
    const [aura] = dawnSentences(rod.description);
    // The rod's dawn closes Protective Aura, and its spells are under Spells.
    expect(underAnotherProperty(rod.description, aura!, 'Detect Magic')).toBe(true);
    // The cloak's closes Web, and Web is named under Web.
    const cloak = entryFor(SRD_MAGIC_ITEMS.find((item) => item.id === 'cloak-of-arachnida')!);
    const [web] = dawnSentences(cloak.description);
    expect(underAnotherProperty(cloak.description, web!, 'Web')).toBe(false);
    // And the rod's spells moved under the aura would be limited by it.
    const moved = rod.description.replace(
      "The rod's head stops glowing",
      '_Detect Magic_ again. The rod\'s head stops glowing',
    );
    expect(underAnotherProperty(moved, aura!, 'Detect Magic')).toBe(false);
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
      const entry = entryFor(item);
      for (const note of item.unmodelled ?? []) {
        for (const { run } of quotedRunsIn(note)) {
          if (contains(entry.description, run)) continue;
          misquoted.push(`${item.id} attributes to ${entry.name} a run it does not contain: "${run}"`);
        }
      }
    }
    expect(misquoted).toEqual([]);

    /**
     * **A handover is held harder than a note**, because it *is* the
     * quotation: a note quotes the page inside a reason, and a `dmDecides`
     * entry is the book's own words and nothing else — what the table is
     * handed is what the page prints. So the whole entry must be found in the
     * item's own paragraph (an ellipsis may join two runs of it), not just
     * whatever it puts in quotation marks.
     */
    const unprinted = (item: CatalogueItem): readonly string[] => {
      const entry = entryFor(item);
      return (item.dmDecides ?? [])
        .filter((printed) => !contains(entry.description, printed))
        .map((printed) => `${item.id} hands over what ${entry.name} does not print: "${printed}"`);
    };
    const handing = SRD_MAGIC_ITEMS.filter((item) => item.dmDecides !== undefined);
    expect(handing.length).toBeGreaterThan(0);
    expect(handing.flatMap(unprinted)).toEqual([]);

    // And it bites: the cube's faces, reworded by one word, are not the page.
    const cube = SRD_MAGIC_ITEMS.find((item) => item.id === 'cube-of-force')!;
    expect(unprinted({ ...cube, dmDecides: ['Each face has a distinct rune on it.'] })).toHaveLength(1);
  });

  /**
   * **A last charge is a clause of the page too**, and one that takes the
   * item away — so a record may say it only where its own entry does: "If you
   * expend the wand's last charge, roll 1d20. On a 1, …" for a die, and "last
   * charge" at the least for one that always destroys. A crumble written onto
   * an item whose page prints none would be a worse item than the book's, and
   * one written at the wrong face a different one.
   */
  it('destroys an item on its last charge only where its entry says so', () => {
    const unprinted: string[] = [];
    let checked = 0;
    for (const item of SRD_MAGIC_ITEMS) {
      const pool = (item.grants ?? []).find((grant) => grant.kind === 'pool');
      const last = pool !== undefined && 'onLastCharge' in pool ? pool.onLastCharge : undefined;
      if (last === undefined) continue;
      checked += 1;
      const entry = entryFor(item);
      const says =
        last.destroyed === true
          ? contains(entry.description, 'last charge, roll 1d20') &&
            contains(entry.description, `On a ${last.onD20AtOrBelow},`)
          : contains(entry.description, 'last charge');
      if (!says) unprinted.push(`${item.id} is destroyed on its last charge and ${entry.name} does not say so`);
    }
    expect(unprinted).toEqual([]);
    expect(checked).toBeGreaterThan(5);
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
    // And the one whose die needed the *target* narrowing as well, which
    // `targetTypes` is: "if the target is a Dragon" and nothing else owed.
    expect(complete.map((item) => item.id)).toContain('dragon-slayer');

    // Still partial, and each note says which clause is still the table's.
    const stillOwed: Readonly<Record<string, string>> = {
      'sword-of-wounding': 'Constitution saving throw',
      'frost-brand': 'extinguish all nonmagical flames',
      'giant-slayer': 'DC 15 Strength saving throw',
      'holy-avenger': '17 or more levels in the Paladin class',
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
