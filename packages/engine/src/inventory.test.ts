import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type Result } from '@ie/shared';
import { armorClass } from './character.js';
import { goldToCopper } from './catalogue.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { levelGrantedSpells, type SpellbookEntry } from './spellbook.js';
import { advanceCharacter, createCharacter, type CharacterChoices, type DmGrants } from './creation.js';
import { carrying, coinsOf, equipItem, purchaseItem, unequipItem } from './commands.js';

/**
 * From the choices a character was made with, to what is in their hands.
 *
 * Four things this has to keep straight, and the last is the one that bites:
 *
 * - **Owning is not wearing.** Chain mail in a backpack protects nobody, so
 *   Armour Class reads what is equipped and never the inventory.
 * - **A pack is its contents.** Buying a Scholar's Pack puts nine things in
 *   your hands, not one labelled bundle.
 * - **Money is spent once.** Taking package A means taking its gold *and* its
 *   items; there is no route that grants both a package and the money instead
 *   of it.
 * - **A refused operation changes nothing** — no half-spent purse, no item
 *   equipped off the back of a failed check.
 */

const id = (s: string) => asCharacterId(s);
const KESSA = id('kessa');

const book = (level: number): SpellbookEntry[] =>
  ['magic-missile', 'shield', 'detect-magic', 'feather-fall', 'mage-armor', 'hold-person',
   'thunderwave', 'charm-person', 'misty-step', 'web']
    .slice(0, levelGrantedSpells(level))
    .map((spellId, index) => ({
      spellId,
      acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
      origin: 'level' as const,
    }));

const kessa = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Kessa',
  classId: 'wizard',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Chaotic Good',
  subclassId: 'evoker',
  cantrips: ['fire-bolt', 'light', 'prestidigitation'],
  spellbook: book(3),
  preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'hold-person', 'burning-hands', 'scorching-ray'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'wizard:scholar': ['arcana'],
    'human:skillful': ['perception'],
    'evoker:evocation-savant': ['burning-hands', 'scorching-ray'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'survival'] },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

const made = (over: Partial<CharacterChoices> = {}): GameEvent[] =>
  unwrap(createCharacter(SRD_CONTENT,kessa(over), KESSA), 'create');

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<GameEvent[]>,
): { log: GameEvent[]; state: GameState } => {
  const events = unwrap(command(fold('seed', log)), 'command');
  const next = [...log, ...events];
  return { log: next, state: fold('seed', next) };
};

const held = (state: GameState, itemId: string): number =>
  carrying(state, KESSA).find((line) => line.id === itemId)?.quantity ?? 0;

/**
 * `equipped` is the fact; the sheet's armour is a view of it.
 *
 * Anything that leaves the two disagreeing is a bug whatever else it got
 * right, because Armour Class reads the view and every refusal reads the fact.
 */
const sheetAgreesWithEquipment = (state: GameState): void => {
  const creature = state.creatures.kessa;
  if (creature === undefined) return;
  const pieces = creature.equipped.map((held) => held.armor);
  expect(creature.sheet.armor).toEqual(
    pieces.find((piece) => piece !== null && piece.category !== 'shield') ?? null,
  );
  expect(creature.sheet.shield).toEqual(
    pieces.find((piece) => piece !== null && piece.category === 'shield') ?? null,
  );
};

describe('the catalogue is keyed by id, not by display text', () => {
  /**
   * The gear table alphabetises by inverting names — it prints `Lantern,
   * Hooded` where a person says "hooded lantern" — so matching on display text
   * is how a package silently stops containing a lantern.
   */
  it('finds an item whose printed name nobody would type', () => {
    expect(SRD_CONTENT.item('lantern-hooded')?.name).toBe('Lantern, Hooded');
    expect(SRD_CONTENT.item('quarterstaff')?.kind).toBe('weapon');
    expect(SRD_CONTENT.item('calligraphers-supplies')?.kind).toBe('tool');
    expect(SRD_CONTENT.item('chain-shirt')?.kind).toBe('armor');
    expect(SRD_CONTENT.item('not-a-thing')).toBeNull();
  });

  it('prices everything in copper, the unit the coins divide into', () => {
    // SRD: a Backpack is 2 GP.
    expect(SRD_CONTENT.item('backpack')?.costCp).toBe(goldToCopper(2));
    // And a Blanket is 5 SP, which no gold-only arithmetic could hold.
    expect(SRD_CONTENT.item('blanket')?.costCp).toBe(50);
  });

  /** SRD: a Scholar's Pack "contains the following items: ..." */
  it('expands a pack into the pack and everything in it', () => {
    const contents = SRD_CONTENT.expandPack('scholars-pack');
    expect(contents[0]).toEqual({ id: 'scholars-pack', quantity: 1 });
    expect(contents).toContainEqual({ id: 'oil', quantity: 10 });
    expect(contents).toContainEqual({ id: 'parchment', quantity: 10 });
    expect(contents).toHaveLength(9);
  });

  it('leaves an ordinary item as itself', () => {
    expect(SRD_CONTENT.expandPack('backpack')).toEqual([{ id: 'backpack', quantity: 1 }]);
  });
});

describe('creation fills the pack', () => {
  it('puts both packages in the inventory, by id and quantity', () => {
    const state = fold('seed', made());
    // SRD Wizard package A: 2 Daggers, an Arcane Focus, a Robe, a Spellbook,
    // a Scholar's Pack and 5 GP.
    expect(held(state, 'dagger')).toBe(2);
    expect(held(state, 'spellbook')).toBe(1);
    // Sage package A brings the Calligrapher's Supplies and 8 sheets.
    expect(held(state, 'calligraphers-supplies')).toBe(1);
    expect(held(state, 'parchment')).toBe(8 + 10);
  });

  /** The pack's contents are in your hands, not just the pack's name. */
  it('opens the Scholar’s Pack rather than recording a label', () => {
    const state = fold('seed', made());
    expect(held(state, 'scholars-pack')).toBe(1);
    expect(held(state, 'oil')).toBe(10);
    expect(held(state, 'tinderbox')).toBe(1);
  });

  it('adds the coin from both packages, once', () => {
    // 5 GP from the Wizard package, 8 from Sage.
    expect(coinsOf(fold('seed', made()), KESSA)).toBe(goldToCopper(13));
  });

  /**
   * SRD offers "Choose A or B": the package *or* the money. Taking B must not
   * also hand over A's contents, and taking A must not also hand over B's gold.
   */
  it('grants the money instead of the items, never both', () => {
    const gold = fold('seed', made({ classEquipment: 'B', backgroundEquipment: 'B' }));
    expect(coinsOf(gold, KESSA)).toBe(goldToCopper(105));
    expect(carrying(gold, KESSA)).toEqual([]);

    const mixed = fold('seed', made({ classEquipment: 'B', backgroundEquipment: 'A' }));
    expect(coinsOf(mixed, KESSA)).toBe(goldToCopper(55 + 8));
    expect(held(mixed, 'spellbook')).toBe(0);
    expect(held(mixed, 'calligraphers-supplies')).toBe(1);
  });

  it('survives a round trip with its inventory intact', () => {
    const state = fold('seed', made());
    const revived = JSON.parse(JSON.stringify(state)) as GameState;
    expect(revived).toEqual(state);
    expect(held(revived, 'oil')).toBe(10);
  });
});

describe('created already wearing what the GM granted', () => {
  const inArmour = (): GameEvent[] =>
    made({
      dmGrants: {
        items: [{ id: 'chain-shirt', quantity: 1 }],
        goldPieces: 0,
        magicItems: [],
        note: 'salvaged from the vault',
      },
      equipped: ['chain-shirt'],
    });

  /**
   * The whole path in one step: a creation choice puts the shirt in the
   * inventory, the same choice puts it on, and Armour Class reads the result.
   */
  it('owns it, wears it, and has the Armour Class to show for it', () => {
    const state = fold('seed', inArmour());
    expect(held(state, 'chain-shirt')).toBe(1);
    expect(state.creatures.kessa!.equipped.map((held) => held.id)).toEqual(['chain-shirt']);
    expect(armorClass(state.creatures.kessa!.sheet)).toBe(15);
  });

  it('can take off what creation put on, and is back to 12', () => {
    const { state } = run(inArmour(), (s) => unequipItem(s, SRD_CONTENT, KESSA, 'chain-shirt'));
    expect(armorClass(state.creatures.kessa!.sheet)).toBe(12);
    expect(held(state, 'chain-shirt')).toBe(1);
  });
});

describe('buying things with what is left', () => {
  const shopping = () => made({ classEquipment: 'B', backgroundEquipment: 'B' });

  it('adds the item and takes the money', () => {
    const { state } = run(shopping(), (s) => purchaseItem(s, SRD_CONTENT, KESSA, 'chain-shirt', 1));
    expect(held(state, 'chain-shirt')).toBe(1);
    // Chain Shirt is 50 GP out of 105.
    expect(coinsOf(state, KESSA)).toBe(goldToCopper(55));
  });

  it('multiplies the price by the quantity', () => {
    const { state } = run(shopping(), (s) => purchaseItem(s, SRD_CONTENT, KESSA, 'torch', 10));
    expect(held(state, 'torch')).toBe(10);
    // A Torch is 1 CP.
    expect(coinsOf(state, KESSA)).toBe(goldToCopper(105) - 10);
  });

  it('buys a pack and gets everything in it', () => {
    const { state } = run(shopping(), (s) => purchaseItem(s, SRD_CONTENT, KESSA, 'scholars-pack', 1));
    expect(held(state, 'oil')).toBe(10);
    expect(coinsOf(state, KESSA)).toBe(goldToCopper(65));
  });

  it('refuses what cannot be afforded, spending nothing', () => {
    const before = fold('seed', shopping());
    const result = purchaseItem(before, SRD_CONTENT, KESSA, 'plate-armor', 1);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('cannot_afford');
    expect(fold('seed', shopping())).toEqual(before);
  });

  it('refuses an item nobody sells, and a quantity that is not a count', () => {
    const before = fold('seed', shopping());
    expect(isErr(purchaseItem(before, SRD_CONTENT, KESSA, 'vorpal-sword', 1))).toBe(true);
    expect(isErr(purchaseItem(before, SRD_CONTENT, KESSA, 'torch', 0))).toBe(true);
    expect(isErr(purchaseItem(before, SRD_CONTENT, KESSA, 'torch', 1.5))).toBe(true);
  });

  /** SRD prints "Varies" for some rows; a price nobody stated cannot be paid. */
  it('refuses an item whose price the SRD leaves open', () => {
    const result = purchaseItem(fold('seed', shopping()), SRD_CONTENT, KESSA, 'arcane-focus', 1);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('no_price');
  });

  it('is a no-op when the same purchase is retried', () => {
    const first = run(shopping(), (s) => purchaseItem(s, SRD_CONTENT, KESSA, 'torch', 5, 'buy-1'));
    const retry = unwrap(purchaseItem(first.state, SRD_CONTENT, KESSA, 'torch', 5, 'buy-1'), 'retry');
    expect(retry).toEqual([]);
    expect(fold('seed', [...first.log, ...retry])).toEqual(first.state);
  });

  /**
   * A retry is the *same* command arriving twice. A different order under the
   * same id is a caller bug, and swallowing it would lose a purchase silently.
   */
  it('refuses the same command id carrying different inputs', () => {
    const first = run(shopping(), (s) => purchaseItem(s, SRD_CONTENT, KESSA, 'torch', 5, 'buy-1'));
    const different = purchaseItem(first.state, SRD_CONTENT, KESSA, 'torch', 6, 'buy-1');
    expect(isErr(different)).toBe(true);
    if (isErr(different)) expect(different.code).toBe('command_id_reused');
    expect(fold('seed', first.log)).toEqual(first.state);
  });
});

describe('owning, wearing, and Armour Class', () => {
  const armoured = () => {
    const bought = run(made({ classEquipment: 'B', backgroundEquipment: 'B' }), (s) =>
      purchaseItem(s, SRD_CONTENT, KESSA, 'chain-shirt', 1),
    );
    return run(bought.log, (s) => purchaseItem(s, SRD_CONTENT, KESSA, 'shield', 1));
  };

  /** No armour and no training: 10 + Dexterity. */
  it('starts unarmoured', () => {
    const state = fold('seed', made());
    expect(armorClass(state.creatures.kessa!.sheet)).toBe(12);
  });

  it('changes nothing by owning armour', () => {
    const { state } = armoured();
    expect(held(state, 'chain-shirt')).toBe(1);
    expect(armorClass(state.creatures.kessa!.sheet)).toBe(12);
  });

  it('raises Armour Class when the armour goes on', () => {
    const { state } = run(armoured().log, (s) => equipItem(s, SRD_CONTENT, KESSA, 'chain-shirt'));
    // Chain Shirt is 13 + Dexterity, capped at +2.
    expect(armorClass(state.creatures.kessa!.sheet)).toBe(15);
    expect(state.creatures.kessa!.equipped.map((held) => held.id)).toEqual(['chain-shirt']);
  });

  /**
   * SRD: a Shield adds 2 — but "you must have training with any armor you are
   * wearing", and a Wizard has none. The AC calculation already knows; the
   * point here is that equipping does not quietly grant the benefit.
   */
  it('holds a shield without granting an untrained wizard its bonus', () => {
    const worn = run(armoured().log, (s) => equipItem(s, SRD_CONTENT, KESSA, 'chain-shirt'));
    const { state } = run(worn.log, (s) => equipItem(s, SRD_CONTENT, KESSA, 'shield'));
    expect(state.creatures.kessa!.equipped.map((held) => held.id).sort()).toEqual(['chain-shirt', 'shield']);
    expect(armorClass(state.creatures.kessa!.sheet)).toBe(15);
  });

  it('puts it back down again', () => {
    const worn = run(armoured().log, (s) => equipItem(s, SRD_CONTENT, KESSA, 'chain-shirt'));
    const { state } = run(worn.log, (s) => unequipItem(s, SRD_CONTENT, KESSA, 'chain-shirt'));
    expect(armorClass(state.creatures.kessa!.sheet)).toBe(12);
    expect(state.creatures.kessa!.equipped.map((held) => held.id)).toEqual([]);
    // And it is still owned: taking it off is not throwing it away.
    expect(held(state, 'chain-shirt')).toBe(1);
  });

  it('refuses to equip what is not owned, changing nothing', () => {
    const before = fold('seed', made());
    const result = equipItem(before, SRD_CONTENT, KESSA, 'plate-armor');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('not_owned');
    expect(fold('seed', made())).toEqual(before);
  });

  it('refuses to equip something that is not worn or wielded', () => {
    const result = equipItem(fold('seed', made()), SRD_CONTENT, KESSA, 'parchment');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('not_equippable');
  });

  /** SRD: one suit of armour at a time; a second is a different suit. */
  it('refuses a second suit of body armour', () => {
    const bought = run(armoured().log, (s) => purchaseItem(s, SRD_CONTENT, KESSA, 'leather-armor', 1));
    const worn = run(bought.log, (s) => equipItem(s, SRD_CONTENT, KESSA, 'chain-shirt'));
    const result = equipItem(worn.state, SRD_CONTENT, KESSA, 'leather-armor');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('slot_taken');
    expect(fold('seed', worn.log)).toEqual(worn.state);
  });

  it('refuses to equip the same thing twice', () => {
    const worn = run(armoured().log, (s) => equipItem(s, SRD_CONTENT, KESSA, 'chain-shirt'));
    expect(isErr(equipItem(worn.state, SRD_CONTENT, KESSA, 'chain-shirt'))).toBe(true);
  });

  it('refuses to take off what is not on', () => {
    const result = unequipItem(fold('seed', made()), SRD_CONTENT, KESSA, 'chain-shirt');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('not_equipped');
  });

  it('is a no-op when the same equip is retried', () => {
    const worn = run(armoured().log, (s) => equipItem(s, SRD_CONTENT, KESSA, 'chain-shirt', 'wear-1'));
    const retry = unwrap(equipItem(worn.state, SRD_CONTENT, KESSA, 'chain-shirt', 'wear-1'), 'retry');
    expect(retry).toEqual([]);
    expect(fold('seed', [...worn.log, ...retry])).toEqual(worn.state);
  });
});

describe('advancement keeps the equipment and redoes the arithmetic', () => {
  const ADVANCE_TO_4 = {
    cantrips: ['fire-bolt', 'light', 'prestidigitation', 'mending'],
    newSpells: ['sleep', 'invisibility'],
    preparedSpells: [
      'magic-missile',
      'shield',
      'mage-armor',
      'hold-person',
      'burning-hands',
      'scorching-ray',
      'misty-step',
    ],
    featureChoices: {
      'wizard:scholar': ['arcana'],
      'human:skillful': ['perception'],
      'evoker:evocation-savant': ['burning-hands', 'scorching-ray'],
    },
    feats: {
      ...kessa().feats,
      'wizard:ability-score-improvement': { featId: 'alert' as const },
    },
  };

  const grant = (note: string) => ({
    items: [{ id: 'chain-shirt', quantity: 1 }],
    goldPieces: 0,
    magicItems: [],
    note,
  });

  const levelUp = (log: readonly GameEvent[], dmGrants: DmGrants) =>
    run(log, (st) => advanceCharacter(st, SRD_CONTENT, KESSA, { ...ADVANCE_TO_4, dmGrants }));

  /**
   * The GM's note for level 4 is about level 4. It does not re-list the shirt
   * they handed over at level 1, and it should not have to: the shirt is in the
   * inventory, which is state, not in a creation choice, which is a record of
   * what was decided once.
   */
  it('advances a character wearing armour the new GM note does not re-list', () => {
    const start = made({ dmGrants: grant('salvaged'), equipped: ['chain-shirt'] });
    const levelled = levelUp(start, { items: [], goldPieces: 0, magicItems: [], note: 'nothing new' });

    expect(levelled.state.creatures.kessa!.character?.level).toBe(4);
    expect(levelled.state.creatures.kessa!.equipped.map((held) => held.id)).toEqual(['chain-shirt']);
    expect(armorClass(levelled.state.creatures.kessa!.sheet)).toBe(15);
    expect(held(levelled.state, 'chain-shirt')).toBe(1);
  });

  /** Bought and worn after creation, so no creation choice mentions it at all. */
  it('keeps armour that was bought and put on after the character existed', () => {
    const bought = run(made({ classEquipment: 'B', backgroundEquipment: 'B' }), (st) =>
      purchaseItem(st, SRD_CONTENT, KESSA, 'chain-shirt', 1),
    );
    const worn = run(bought.log, (st) => equipItem(st, SRD_CONTENT, KESSA, 'chain-shirt'));
    expect(armorClass(worn.state.creatures.kessa!.sheet)).toBe(15);

    const levelled = levelUp(worn.log, {
      items: [],
      goldPieces: 0,
      magicItems: [],
      note: 'nothing new',
    });
    expect(levelled.state.creatures.kessa!.equipped.map((held) => held.id)).toEqual(['chain-shirt']);
    expect(armorClass(levelled.state.creatures.kessa!.sheet)).toBe(15);
  });

  /**
   * The other direction, and the one a patched sheet gets wrong: creation put
   * the shirt on, so `choices.equipped` names it forever. Taking it off is
   * state the record never hears about, and the new level's sheet must read the
   * state rather than the record.
   */
  it('does not put back armour the character took off before levelling', () => {
    const start = made({ dmGrants: grant('salvaged'), equipped: ['chain-shirt'] });
    const bare = run(start, (st) => unequipItem(st, SRD_CONTENT, KESSA, 'chain-shirt'));
    const levelled = levelUp(bare.log, { items: [], goldPieces: 0, magicItems: [], note: 'nothing new' });

    expect(levelled.state.creatures.kessa!.equipped.map((held) => held.id)).toEqual([]);
    expect(levelled.state.creatures.kessa!.sheet.armor).toBeNull();
    expect(armorClass(levelled.state.creatures.kessa!.sheet)).toBe(12);
  });

  /** Everything else on the sheet *is* recalculated: this is a level 4 Wizard. */
  it('rebuilds the rest of the sheet from the new level', () => {
    const start = made({ dmGrants: grant('salvaged'), equipped: ['chain-shirt'] });
    const before = fold('seed', start);
    const levelled = levelUp(start, { items: [], goldPieces: 0, magicItems: [], note: 'nothing new' });
    const after = levelled.state.creatures.kessa!;

    expect(after.sheet.level).toBe(4);
    expect(after.vitals.hpMax).toBeGreaterThan(before.creatures.kessa!.vitals.hpMax);
    // Level 4 is where the Wizard's fourth cantrip and a second level 2 slot land.
    expect(after.resources.pools['spell-slot:2']?.max).toBe(3);
    // And the armour came through all of it.
    expect(after.sheet.armor?.name).toBe('Chain Shirt');
  });
});

describe('the whole path replays', () => {
  const played = (): GameEvent[] => {
    const bought = run(made({ classEquipment: 'B', backgroundEquipment: 'B' }), (s) =>
      purchaseItem(s, SRD_CONTENT, KESSA, 'chain-shirt', 1),
    );
    const more = run(bought.log, (s) => purchaseItem(s, SRD_CONTENT, KESSA, 'scholars-pack', 1));
    const worn = run(more.log, (s) => equipItem(s, SRD_CONTENT, KESSA, 'chain-shirt'));
    return run(worn.log, (s) => unequipItem(s, SRD_CONTENT, KESSA, 'chain-shirt')).log;
  };

  it('folds to the same state twice', () => {
    const log = played();
    expect(fold('seed', log)).toEqual(fold('seed', log));
  });

  it('replays prefix by prefix', () => {
    const log = played();
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });

  /** And at no point along the way does the sheet disagree with the facts. */
  it('keeps the sheet agreeing with the equipped set at every step', () => {
    const log = played();
    for (let n = 0; n <= log.length; n += 1) {
      sheetAgreesWithEquipment(fold('seed', log.slice(0, n)));
    }
  });

  it('survives JSON with coins, inventory and Armour Class intact', () => {
    const state = fold('seed', played());
    const revived = JSON.parse(JSON.stringify(state)) as GameState;
    expect(revived).toEqual(state);
    expect(armorClass(revived.creatures.kessa!.sheet)).toBe(12);
    expect(held(revived, 'oil')).toBe(10);
  });

  /**
   * Levelling up derives a fresh sheet, which knows nothing about the shirt.
   * Gaining a level does not take your armour off — and it does not hand you a
   * second starting package or its gold either.
   */
  it('keeps what is worn, and grants nothing again, when a level is gained', () => {
    const worn = run(played(), (s) => equipItem(s, SRD_CONTENT, KESSA, 'chain-shirt'));
    expect(armorClass(worn.state.creatures.kessa!.sheet)).toBe(15);

    const before = coinsOf(worn.state, KESSA);
    const levelled = run(worn.log, (s) =>
      advanceCharacter(s, SRD_CONTENT, KESSA, {
        cantrips: ['fire-bolt', 'light', 'prestidigitation', 'mending'],
        // Level 4 has no level 3 slot, and a Wizard copies only spells "of a
        // level you can prepare" — so these are both level 2 or lower.
        newSpells: ['sleep', 'invisibility'],
        preparedSpells: [
          'magic-missile',
          'shield',
          'mage-armor',
          'hold-person',
          'burning-hands',
          'scorching-ray',
          'misty-step',
        ],
        featureChoices: {
          'wizard:scholar': ['arcana'],
          'human:skillful': ['perception'],
          'evoker:evocation-savant': ['burning-hands', 'scorching-ray'],
        },
        feats: {
          ...kessa().feats,
          'wizard:ability-score-improvement': { featId: 'alert' },
        },
        dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
      }),
    );

    expect(armorClass(levelled.state.creatures.kessa!.sheet)).toBe(15);
    expect(levelled.state.creatures.kessa!.equipped.map((held) => held.id)).toEqual(['chain-shirt']);
    expect(coinsOf(levelled.state, KESSA)).toBe(before);
    expect(held(levelled.state, 'chain-shirt')).toBe(1);
    expect(held(levelled.state, 'oil')).toBe(10);
  });
});
