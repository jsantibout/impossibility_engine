import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap } from '@ie/shared';
import type { CatalogueItem } from './catalogue.js';
import { abilityModifier, modifierFor } from './character.js';
import { checkContent, extendContent, loadContent, type Content } from './content.js';
import { fold, type GameEvent } from './events.js';
import type { GameState } from './state.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { attuneItem, equipItem, unequipItem } from './commands/inventory.js';
import { beginRest } from './rest.js';
import {
  abilityScoresOf,
  armorClassOf,
  sheetAsItStands,
  standingSaveBonuses,
} from './standing.js';

/**
 * A score an item **sets**, which is a third verb.
 *
 * The engine could raise a score and lift its ceiling, both at creation, and
 * neither says what the SRD says of the Amulet of Health: "Your Constitution
 * is 19 while you wear this amulet. It has no effect on you if your
 * Constitution is 19 or higher without it." Three things follow from that one
 * sentence and each is a test below.
 *
 * - **Set, not add.** 8 becomes 19 and 20 stays 20; a raise could say
 *   neither.
 * - **While worn.** It is live when the item is on and gone when it comes
 *   off, which is the lifetime `standing.ts` already insists must be derived
 *   on every read rather than stored — "a stored copy would be an
 *   unconditional bonus wearing a feature's name".
 * - **The modifier moves with it**, because a score is not a number on its
 *   own.
 *
 * **What this file drives, and what drives the rest.** Two readers in
 * `standing.ts` move with a set score and are proved here: `armorClassOf`,
 * which asks `sheetAsItStands` because it wants a whole sheet, and
 * `standingSaveBonuses`, which asks `abilityScoresOf` because it wants one
 * holder's one score. The rollers above them move too, and are driven through
 * the public commands in two files rather than here, because `attack.ts` and
 * `checks.ts` take a sheet and hold no state: the substitution is the
 * command's to make. `set-score-reaches-the-roll.test.ts` drives an attack,
 * its damage, an ability check, a saving throw, Initiative and a Reaction's
 * addend; `set-score-reaches-the-casting.test.ts` drives the casting family —
 * a spell save DC, a spell attack modifier, an item's casting, the rolls a
 * spell's effects make, the Concentration save, the two rolls a turn boundary
 * repeats and a self-heal's addend.
 *
 * Driven through homebrew items for `content.test.ts`'s reason — a mechanic
 * proved only against the book's own catalogue is a mechanic that might be
 * reading the book — and then through the three SRD entries it frees, in the
 * last block, because a vocabulary with no printed consumer is a vocabulary
 * nobody has checked against a page.
 */

const WHO = asCharacterId('vashti');

/** SRD Gauntlets of Ogre Power, said by an item nobody printed. */
const BRACERS: CatalogueItem = {
  id: 'bracers-of-the-titan',
  name: 'Bracers of the Titan',
  kind: 'wondrous',
  weightLb: null,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  grants: [
    {
      kind: 'standing',
      reach: 'self',
      effects: [{ kind: 'ability-score-set', ability: 'str', score: 19 }],
      requires: [{ kind: 'while-worn' }],
    },
  ],
};

/** The same verb on Dexterity, and behind an attunement rather than a strap. */
const CIRCLET: CatalogueItem = {
  id: 'circlet-of-the-cat',
  name: 'Circlet of the Cat',
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
      effects: [{ kind: 'ability-score-set', ability: 'dex', score: 18 }],
      requires: [{ kind: 'while-attuned' }],
    },
  ],
};

/** A bigger one of the same family, for the rule about two of them. */
const GREATER: CatalogueItem = {
  ...BRACERS,
  id: 'bracers-of-the-storm-titan',
  name: 'Bracers of the Storm Titan',
  grants: [
    {
      kind: 'standing',
      reach: 'self',
      effects: [{ kind: 'ability-score-set', ability: 'str', score: 23 }],
      requires: [{ kind: 'while-worn' }],
    },
  ],
};

/**
 * A Paladin's aura, as an item, beside something that sets the score it is
 * sized by.
 *
 * SRD Aura of Protection: "you and your allies have a bonus to saving throws
 * equal to your Charisma modifier (minimum bonus of +1)" — the *holder's*
 * modifier. It is the one reader in this file that wants a single score
 * rather than a sheet, so it is the one that has to be driven separately.
 */
const AEGIS: CatalogueItem = {
  ...BRACERS,
  id: 'aegis-of-the-warden',
  name: 'Aegis of the Warden',
  grants: [
    {
      kind: 'standing',
      reach: 'self',
      effects: [{ kind: 'save-bonus', fromAbility: 'cha', minimum: 1 }],
      requires: [{ kind: 'while-worn' }],
    },
  ],
};

/** And the thing that moves the Charisma the aegis is sized by. */
const TORC: CatalogueItem = {
  ...BRACERS,
  id: 'torc-of-command',
  name: 'Torc of Command',
  grants: [
    {
      kind: 'standing',
      reach: 'self',
      effects: [{ kind: 'ability-score-set', ability: 'cha', score: 20 }],
      requires: [{ kind: 'while-worn' }],
    },
  ],
};

const CONTENT: Content = unwrap(
  extendContent(SRD_CONTENT, { items: [BRACERS, CIRCLET, GREATER, AEGIS, TORC] }),
  'extend',
);

/** A Fighter with a Strength of 8 and a Dexterity of 15, so a set is visible. */
const fighter = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Vashti',
  classId: 'fighter',
  level: 1,
  speciesId: 'human',
  backgroundId: 'soldier',
  abilities: {
    method: 'manual',
    assignment: { str: 8, dex: 15, con: 13, int: 12, wis: 10, cha: 14 },
  },
  abilityIncreases: { str: 2, con: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'soldier:savage-attacker': { featId: 'savage-attacker' },
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'defense' },
  },
  dmGrants: {
    items: [
      { id: BRACERS.id, quantity: 1 },
      { id: CIRCLET.id, quantity: 1 },
      { id: GREATER.id, quantity: 1 },
      { id: AEGIS.id, quantity: 1 },
      { id: TORC.id, quantity: 1 },
    ],
    goldPieces: 0,
    magicItems: [BRACERS.id, CIRCLET.id, GREATER.id, AEGIS.id, TORC.id],
    note: 'the five under test',
  },
  ...over,
});

/**
 * A character and the log that built them, stepped by hand.
 *
 * The log is carried rather than read off the state, because `GameState` is
 * a fold of events and holds none.
 */
const built = (
  choices: CharacterChoices = fighter(),
  content: Content = CONTENT,
): readonly GameEvent[] => unwrap(createCharacter(content, choices, WHO), 'create') as GameEvent[];

const after = (
  log: readonly GameEvent[],
  step: (state: GameState) => readonly GameEvent[],
): readonly GameEvent[] => [...log, ...step(fold('seed', log))];

const wearing = (...items: readonly string[]): GameState => {
  let log = built();
  for (const id of items) {
    log = after(log, (state) =>
      unwrap(equipItem(state, CONTENT, WHO, id, `equip-${id}`), id),
    );
  }
  return fold('seed', log);
};

/**
 * The same, with the item attuned to rather than worn.
 *
 * SRD: attunement is "a Short Rest spent focused on it", so the rest is part
 * of the path and the command refuses one that skipped it.
 */
const attunedTo = (item: string, log: readonly GameEvent[] = built()): GameState => {
  const resting = after(log, (state) => unwrap(beginRest(state, WHO, 'short'), 'rest'));
  return fold(
    'seed',
    after(resting, (state) =>
      unwrap(attuneItem(state, CONTENT, WHO, item, `attune-${item}`), item),
    ),
  );
};

/** The state a Fighter who owns all three starts in, wearing none of them. */
const start = (): GameState => fold('seed', built());

describe('a score an item sets', () => {
  it('sets it while the item is worn', () => {
    expect(start().creatures[WHO]?.sheet.abilities.str).toBe(10);
    expect(abilityScoresOf(wearing(BRACERS.id), WHO).str).toBe(19);
  });

  /**
   * The modifier on the sheet `sheetAsItStands` hands back, which is the one
   * `rollAbilityCheck` is now given: the stored sheet keeps the built score,
   * and the substituted one carries the worn score down to the die.
   */
  it('moves the modifier on the sheet a reader is handed', () => {
    const state = wearing(BRACERS.id);
    // 10 is a +0 and 19 is a +4: the set is not a number on its own.
    expect(modifierFor(start().creatures[WHO]!.sheet, 'str')).toBe(0);
    expect(modifierFor(sheetAsItStands(state, WHO)!, 'str')).toBe(abilityModifier(19));
    // And the stored sheet is untouched, which is what makes the two
    // different questions rather than one.
    expect(state.creatures[WHO]?.sheet.abilities.str).toBe(10);
  });

  /** Nothing to hand back for a creature nobody added. */
  it('hands back nothing for a creature this game has never heard of', () => {
    expect(sheetAsItStands(start(), asCharacterId('nobody'))).toBeNull();
  });

  it('leaves a score that is already higher exactly where it was', () => {
    // SRD: "It has no effect on you if your Constitution is 19 or higher
    // without it." Dexterity is 15 here and the circlet sets 18, so it
    // applies; on a character whose Dexterity was 20 it would not.
    const tall = built(
      fighter({
        abilities: {
          method: 'manual',
          assignment: { str: 8, dex: 20, con: 13, int: 12, wis: 10, cha: 14 },
        },
      }),
    );
    expect(abilityScoresOf(attunedTo(CIRCLET.id, tall), WHO).dex).toBe(20);
    // And the same circlet on the character whose Dexterity is 15 does set it,
    // so the rule above is the score rather than the item.
    expect(abilityScoresOf(attunedTo(CIRCLET.id), WHO).dex).toBe(18);
  });

  it('is gone the moment the item comes off', () => {
    const on = after(built(), (state) =>
      unwrap(equipItem(state, CONTENT, WHO, BRACERS.id, 'on'), 'equip'),
    );
    expect(abilityScoresOf(fold('seed', on), WHO).str).toBe(19);

    const off = fold(
      'seed',
      after(on, (state) =>
        unwrap(unequipItem(state, CONTENT, WHO, BRACERS.id, 'off'), 'unequip'),
      ),
    );
    expect(abilityScoresOf(off, WHO).str).toBe(10);
    expect(modifierFor(sheetAsItStands(off, WHO)!, 'str')).toBe(0);
  });

  it('takes the highest of two items that set the same score', () => {
    expect(abilityScoresOf(wearing(BRACERS.id, GREATER.id), WHO).str).toBe(23);
  });

  it('sets nothing for a creature whose attunement the item asks for and has not got', () => {
    // Worn but not attuned: the circlet's own requirement is the attunement.
    expect(abilityScoresOf(wearing(CIRCLET.id), WHO).dex).toBe(15);
  });

  /**
   * The derived reader that already recomputes on a standing change, rather
   * than a second path: Armour Class is Dexterity, and a set Dexterity moves
   * it without `armorClassOf` learning anything new about items.
   */
  it('moves an Armour Class that the score it set is an input to', () => {
    const bare = start();
    expect(armorClassOf(attunedTo(CIRCLET.id), WHO) - armorClassOf(bare, WHO)).toBe(
      abilityModifier(18) - abilityModifier(15),
    );
  });

  /**
   * The other reader that moves, and it moves through a different door:
   * `standingSaveBonuses` wants one holder's one score, so it asks
   * {@link abilityScoresOf} rather than for a whole sheet.
   */
  it('resizes an aura that is sized by the score an item set', () => {
    const aura = (state: GameState) =>
      standingSaveBonuses(state, WHO, 'wis').reduce((sum, one) => sum + (one.flat ?? 0), 0);

    // Charisma 14 is a +2, and the aegis pays the holder's own modifier.
    expect(aura(wearing(AEGIS.id))).toBe(abilityModifier(14));
    // The torc sets it to 20, and the aura is the modifier of the score as
    // it stands rather than the one the sheet was built with.
    expect(aura(wearing(AEGIS.id, TORC.id))).toBe(abilityModifier(20));
  });

  /** And the sheet is the same object when nothing is setting anything. */
  it('hands back the creature’s own sheet when no item sets a score', () => {
    const bare = start();
    expect(sheetAsItStands(bare, WHO)).toBe(bare.creatures[WHO]?.sheet);
  });
});

describe('what the vocabulary refuses at the door', () => {
  const codesOf = (effect: unknown): readonly string[] =>
    checkContent({
      items: [
        {
          ...BRACERS,
          grants: [
            { kind: 'standing', reach: 'self', effects: [effect], requires: [{ kind: 'while-worn' }] },
          ],
        } as unknown as CatalogueItem,
      ],
    }).map((problem) => problem.code);

  it('accepts the item as written, so the refusals below are not free', () => {
    expect(codesOf({ kind: 'ability-score-set', ability: 'str', score: 19 })).toEqual([]);
  });

  it('refuses a set that names something that is not an ability', () => {
    expect(codesOf({ kind: 'ability-score-set', ability: 'luck', score: 19 })).toContain(
      'bad_ability_set',
    );
  });

  it('refuses a score that is not a score a creature can have', () => {
    expect(codesOf({ kind: 'ability-score-set', ability: 'str', score: 0 })).toContain(
      'bad_ability_set',
    );
    expect(codesOf({ kind: 'ability-score-set', ability: 'str', score: 19.5 })).toContain(
      'bad_ability_set',
    );
    expect(codesOf({ kind: 'ability-score-set', ability: 'str', score: 31 })).toContain(
      'bad_ability_set',
    );
  });
});

/**
 * And a homebrew world says the same sentence through the same door.
 */
describe('a homebrew item says it through loadContent', () => {
  it('loads from JSON text and sets the score it was given', () => {
    const loaded = unwrap(
      loadContent(JSON.parse(JSON.stringify({ items: [BRACERS] })) as unknown),
      'load',
    );
    const whole = unwrap(
      extendContent(SRD_CONTENT, { items: [...loaded.items, CIRCLET, GREATER] }),
      'extend',
    );
    const log = built(fighter(), whole);
    const on = fold(
      'seed',
      after(log, (state) =>
        unwrap(equipItem(state, whole, WHO, BRACERS.id, 'equip'), 'equip'),
      ),
    );
    expect(abilityScoresOf(on, WHO).str).toBe(19);
  });
});


/**
 * The three entries whose whole printed text is this one grant.
 *
 * SRD prints the same sentence three times over three scores — "Your
 * Constitution is 19 while you wear this amulet", "Your Strength is 19 while
 * you wear these gauntlets", "Your Intelligence is 19 while you wear this
 * headband" — and each is a Rare or Uncommon wondrous item with an
 * attunement bracket. Driven against `SRD_CONTENT` itself, so the catalogue
 * records are held to the mechanic rather than to each other.
 */
describe('the three SRD items the grant frees', () => {
  const PRINTED = [
    { id: 'amulet-of-health', ability: 'con' },
    { id: 'gauntlets-of-ogre-power', ability: 'str' },
    { id: 'headband-of-intellect', ability: 'int' },
  ] as const;

  /** A Fighter who owns the three, with every score low enough for a set to show. */
  const owner = (assignment: Record<string, number>): CharacterChoices => ({
    ...fighter(),
    abilities: { method: 'manual', assignment: assignment as CharacterChoices['abilities']['assignment'] },
    abilityIncreases: { str: 2, con: 1 },
    dmGrants: {
      items: PRINTED.map((one) => ({ id: one.id, quantity: 1 })),
      goldPieces: 0,
      magicItems: PRINTED.map((one) => one.id),
      note: 'the three printed items under test',
    },
  });

  const LOW = { str: 8, dex: 15, con: 13, int: 12, wis: 10, cha: 14 };

  /**
   * The assignment that puts each score at exactly 20 on the finished sheet.
   *
   * The background raises Strength by 2 and Constitution by 1 here, so a
   * score's own number is 20 less whatever lands on it — and 20 is the
   * ceiling, so a fixture that ignored the increases would be refused by
   * `checkCharacter` rather than tested.
   */
  const AT_TWENTY: Readonly<Record<string, Record<string, number>>> = {
    con: { str: 18, con: 19 },
    str: { str: 18, con: 12 },
    int: { str: 18, con: 12, int: 20 },
  };

  /** Owned, rested, attuned and worn — the whole path the bracket asks for. */
  const putOn = (item: string, assignment: Record<string, number> = LOW) => {
    const owned = built(owner(assignment), SRD_CONTENT);
    const rested = after(owned, (state) => unwrap(beginRest(state, WHO, 'short'), 'rest'));
    const attuned = after(rested, (state) =>
      unwrap(attuneItem(state, SRD_CONTENT, WHO, item, `attune-${item}`), item),
    );
    return after(attuned, (state) =>
      unwrap(equipItem(state, SRD_CONTENT, WHO, item, `equip-${item}`), item),
    );
  };

  for (const { id, ability } of PRINTED) {
    describe(id, () => {
      it('is in the catalogue, attuned and worn, and sets its score to 19', () => {
        expect(SRD_CONTENT.item(id)?.attunement).toBeDefined();
        const on = fold('seed', putOn(id));
        expect(abilityScoresOf(on, WHO)[ability]).toBe(19);
      });

      it('leaves a score that is already higher exactly where it was', () => {
        // SRD: "It has no effect on you if your ... is 19 or higher without
        // it." The assignment is set so the score reaches exactly 20 once
        // the background's own increases land — str +2 and con +1 — because
        // 20 is the ceiling a character with no boon may reach.
        const tall = fold('seed', putOn(id, { ...LOW, ...AT_TWENTY[ability] }));
        // The fixture really is at 20 before the item, which is what makes
        // the assertion below about the item rather than about the sheet.
        expect(tall.creatures[WHO]?.sheet.abilities[ability]).toBe(20);
        expect(abilityScoresOf(tall, WHO)[ability]).toBe(20);
      });

      it('moves the modifier on the sheet a reader is handed, and gives it back', () => {
        const on = putOn(id);
        expect(modifierFor(sheetAsItStands(fold('seed', on), WHO)!, ability)).toBe(
          abilityModifier(19),
        );

        const off = fold(
          'seed',
          after(on, (state) =>
            unwrap(unequipItem(state, SRD_CONTENT, WHO, id, `off-${id}`), 'unequip'),
          ),
        );
        // Taking it off takes the score with it, and the attunement is
        // still there — asserted, because without it the score could have
        // stopped for the other reason and this would say nothing about
        // `while-worn`.
        expect(off.creatures[WHO]?.attuned.some((held) => held.id === id)).toBe(true);
        expect(abilityScoresOf(off, WHO)[ability]).toBe(
          off.creatures[WHO]?.sheet.abilities[ability],
        );
        expect(abilityScoresOf(off, WHO)[ability]).toBeLessThan(19);
      });
    });
  }

  /**
   * And what each of them still does not do, recorded rather than implied.
   *
   * **The note this used to pin is gone, because its sentence stopped being
   * true.** It said an ability check, a saving throw and an attack roll were
   * rolled off the built score "because `checks.ts` and `attack.ts` are handed
   * `creature.sheet` by their commands"; every reader it named — and the
   * casting family beside them — is handed {@link sheetAsItStands} by its
   * command now, so the two items whose whole text is a derived score leave
   * the table nothing and say so by carrying no note at all. A note kept alive
   * to keep a field non-empty is exactly what `unmodelled` exists to prevent.
   *
   * The amulet is the exception, and it is the exception for a reason that is
   * about Constitution rather than about the amulet: a Constitution is *folded*
   * in two places as well as derived everywhere else — into the hit point
   * maximum every level paid, and into the Hit Points a Hit Die restores on a
   * Short Rest. Neither is a reader a sheet substitution reaches.
   */
  it('says in the catalogue what a set score still does not reach', () => {
    for (const { id } of PRINTED) {
      const notes = SRD_CONTENT.item(id)?.unmodelled ?? [];
      expect(notes.some((note) => note.includes('creature.sheet')), id).toBe(false);
    }
    expect(SRD_CONTENT.item('gauntlets-of-ogre-power')?.unmodelled).toBeUndefined();
    expect(SRD_CONTENT.item('headband-of-intellect')?.unmodelled).toBeUndefined();

    const amulet = SRD_CONTENT.item('amulet-of-health')?.unmodelled ?? [];
    expect(amulet).toHaveLength(2);
    expect(amulet.some((note) => note.includes('hit point maximum'))).toBe(true);
    expect(amulet.some((note) => note.includes('Short Rest'))).toBe(true);
  });
});
