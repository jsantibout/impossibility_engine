import { AMMUNITION, ARMOR, GEAR, TOOLS, WEAPONS } from '@ie/srd';
import { COPPER_PER, type CatalogueItem } from '@ie/engine';

/**
 * Every mundane thing the SRD sells, as one catalogue under stable ids.
 *
 * The SRD splits its equipment across four tables that a character sheet does
 * not distinguish between — gear, tools, weapons, armour — so this folds all
 * of them into the engine's one `CatalogueItem` shape, keyed by the slug the
 * parsers already assign.
 */

const priceInCopper = (cost: { kind: string; value?: { amount: number; currency: string } }):
  | number
  | null => {
  if (cost.kind !== 'cost' || cost.value === undefined) return null;
  const per = COPPER_PER[cost.value.currency as keyof typeof COPPER_PER];
  return per === undefined ? null : cost.value.amount * per;
};

const weightInPounds = (weight: { kind: string; value?: number }): number | null => {
  if (weight.kind === 'lb') return weight.value ?? null;
  // "Negligible" is a real answer and it is zero; "Varies" is not an answer.
  return weight.kind === 'negligible' ? 0 : null;
};

/**
 * Things a class hands you that the equipment tables never list.
 *
 * SRD 5.2.1's Adventuring Gear table has no Spellbook row — the object is
 * defined by the Wizard's Spellbook feature instead ("a Tiny object that
 * weighs 3 pounds, contains 100 pages"), and the class package grants one. So
 * the catalogue carries it from the text that does describe it, rather than
 * letting a starting package name an item that resolves to nothing.
 *
 * No price, because the book prints none: buying one is refused rather than
 * guessed, same as any row the SRD leaves as "Varies".
 */
const CLASS_ITEMS: readonly CatalogueItem[] = [
  {
    id: 'spellbook',
    name: 'Spellbook',
    kind: 'gear',
    weightLb: 3,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
  },
];

/**
 * Magic items, transcribed one at a time as the vocabulary reaches them.
 *
 * A magic item is a `CatalogueItem` that has grown grants and an attunement
 * requirement, not a population of its own — see
 * `docs/design/characters-and-equipment.md`. `@ie/srd` parses all 258 of them;
 * what decides whether one can be *transcribed* is whether the engine has a
 * grant kind that says what its line says, and `checkContent` refuses an item
 * whose grant nothing executes rather than accepting a benefit that never
 * applies.
 *
 * The SRD prints no price and no weight for these — the tables that do are for
 * mundane gear — so both are null, and buying one is refused exactly as buying
 * anything the book declines to price is.
 */
const MAGIC_ITEMS: readonly CatalogueItem[] = [
  {
    /**
     * SRD Cloak of Elvenkind: "Wondrous Item, Uncommon (requires attunement).
     * While you wear this cloak, Wisdom (Perception) checks made to perceive
     * you have Disadvantage, and you have Advantage on Dexterity (Stealth)
     * checks."
     *
     * **Half of that sentence is transcribed and half is not, deliberately.**
     * The Stealth clause is an ordinary `roll-mode` grant. The Perception one
     * is a mode on rolls made *against* the wearer, and `against-holder` is
     * legal only on an attack roll — an attack is the one D20 Test the engine
     * records a target for, so "checks made to perceive you" cannot be picked
     * out at all. That clause is the DM's until a selector can say it; it is
     * named here rather than left to be noticed missing.
     */
    id: 'cloak-of-elvenkind',
    name: 'Cloak of Elvenkind',
    kind: 'wondrous',
    weightLb: null,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    attunement: {},
    grants: [
      {
        kind: 'standing',
        reach: 'self',
        effects: [
          {
            kind: 'roll-mode',
            modifier: {
              mode: 'advantage',
              selector: {
                roll: 'ability-check',
                relation: 'roller',
                ability: 'dex',
                skill: 'stealth',
              },
            },
          },
        ],
        // Both clauses of the item's own first line: "while you wear this
        // cloak", and the "(requires attunement)" on the line above it.
        requires: [{ kind: 'while-worn' }, { kind: 'while-attuned' }],
      },
    ],
  },
  {
    /**
     * SRD Wand of Secrets: "Wand, Uncommon. This wand has 3 charges and
     * regains 1d3 expended charges daily at dawn. While holding it, you can
     * take a Magic action to expend 1 charge, and if a secret door or trap is
     * within 60 feet of you, the wand pulses and points at the one nearest to
     * you."
     *
     * **The charges are transcribed and the pointing is not**, and that is the
     * whole of what is deferred here. A wand that finds a secret door is a
     * fact about a room the engine has no walls for — the DM already owns
     * whether there is a door and where — so what the engine owns is the
     * economy: three charges, one spent per look, and a die at dawn. The
     * Magic action the SRD spends is not taken either, for the same reason the
     * effect is not resolved: a `use` grant that spends an action and resolves
     * what the charge buys is the next brief's subject, and half of it written
     * here would be an action spent on nothing.
     */
    id: 'wand-of-secrets',
    name: 'Wand of Secrets',
    kind: 'wand',
    weightLb: null,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      {
        kind: 'pool',
        key: 'wand-of-secrets:charges',
        label: 'Wand of Secrets charges',
        uses: 3,
        recovers: 'dawn',
        regainsAtDawn: '1d3',
      },
    ],
  },
  {
    /**
     * SRD Eyes of Charming: "Wondrous Item, Uncommon (requires attunement).
     * These crystal lenses fit over the eyes. They have 3 charges. While
     * wearing them, you can expend 1 or more charges to cast _Charm Person_
     * (save DC 13)... The lenses regain all expended charges daily at dawn."
     *
     * Here for the other half of the dawn rule: "all expended charges" is the
     * `dawn` recovery tag on its own, with no dice beside it, and it is what
     * `restoreOn` has always done. Casting _Charm Person_ from an item is the
     * same deferred `use` grant the Wand of Secrets is waiting on.
     */
    id: 'eyes-of-charming',
    name: 'Eyes of Charming',
    kind: 'wondrous',
    weightLb: null,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    attunement: {},
    grants: [
      {
        kind: 'pool',
        key: 'eyes-of-charming:charges',
        label: 'Eyes of Charming charges',
        uses: 3,
        recovers: 'dawn',
      },
    ],
  },
];

function build(): readonly CatalogueItem[] {
  const items = new Map<string, CatalogueItem>();

  for (const item of CLASS_ITEMS) items.set(item.id, item);
  for (const item of MAGIC_ITEMS) items.set(item.id, item);

  for (const entry of GEAR) {
    items.set(entry.id, {
      id: entry.id,
      name: entry.name,
      kind: 'gear',
      weightLb: weightInPounds(entry.weight),
      costCp: priceInCopper(entry.cost),
      armor: null,
      weapon: null,
      contents: entry.contents.map((line) => ({ id: line.gearId, quantity: line.quantity })),
    });
  }

  // SRD prices ammunition by the bundle — "Arrows (20)" costs 1 GP — so the
  // catalogue entry is one arrow and `bundleSize` says what a purchase buys.
  // Pricing the bundle as a single item would make one arrow cost a gold piece.
  for (const round of AMMUNITION) {
    const bundle = priceInCopper(round.cost);
    const weight = weightInPounds(round.weight);
    items.set(round.id, {
      id: round.id,
      name: round.name,
      kind: 'ammunition',
      weightLb: weight === null ? null : weight / round.amount,
      costCp: bundle === null ? null : bundle / round.amount,
      armor: null,
      weapon: null,
      contents: [],
      bundleSize: round.amount,
    });
  }

  for (const tool of TOOLS) {
    items.set(tool.id, {
      id: tool.id,
      name: tool.name,
      kind: 'tool',
      weightLb: weightInPounds(tool.weight),
      costCp: priceInCopper(tool.cost),
      armor: null,
      weapon: null,
      contents: [],
    });
  }

  for (const weapon of WEAPONS) {
    items.set(weapon.id, {
      id: weapon.id,
      name: weapon.name,
      kind: 'weapon',
      weightLb: weapon.weightLb,
      costCp: weapon.cost.amount * (COPPER_PER[weapon.cost.currency] ?? 1),
      armor: null,
      weapon,
      contents: [],
    });
  }

  for (const piece of ARMOR) {
    items.set(piece.id, {
      id: piece.id,
      name: piece.name,
      kind: 'armor',
      weightLb: piece.weightLb,
      costCp: piece.cost.amount * (COPPER_PER[piece.cost.currency] ?? 1),
      armor: piece,
      weapon: null,
      contents: [],
    });
  }

  return [...items.values()];
}

/** The SRD's equipment, weapons, armour, tools and ammunition, as engine items. */
export const SRD_ITEMS: readonly CatalogueItem[] = build();
