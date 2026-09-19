import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from '@ie/engine';

/**
 * The Cleric, transcribed from SRD 5.2.1 "Classes".
 *
 * The second class, and the point of it is not the Cleric: it is proving the
 * structures are a *class* system rather than a Wizard with parameters. Three
 * things it does that the Wizard never did, each of which was a seam that had
 * to be opened rather than worked around:
 *
 * - **It prepares from the class list, not from a book.** SRD gives a Cleric
 *   no spellbook at all, so `spellcasting.style` says how a class comes by its
 *   spells and `creation.ts` branches on it. A spellbook entry on a Cleric is
 *   now a refusal rather than something nobody thought to check.
 * - **Its subclass grants prepared spells**, where the Evoker's granted
 *   spellbook entries. Both are `grants: { kind: 'spells' }`, found by what
 *   they do rather than by their ids.
 * - **It wears armour.** The Wizard's `armorTraining` is all false, so every
 *   armour rule in the engine was running against a character who could never
 *   use it. A Cleric in a Chain Shirt and Shield exercises the other branch.
 *
 * Hand-written for the same reason the Wizard is: `classes.md` has no parser.
 * The tests assert *relationships* rather than presence — every printed
 * Proficiency Bonus against the formula, slots never decreasing — and they run
 * against every class definition, so this one failed loudly until it agreed
 * with the engine.
 */

/**
 * Cleric Features table: level, PB, cantrips, prepared, then slots 1-9.
 *
 * Channel Divinity uses are in the printed table too and are not here: they
 * are a resource pool, declared when the character is made, and the table
 * column would be a second place for the same number to disagree from.
 */
const TABLE: readonly (readonly number[])[] = [
  [1, 2, 3, 4, 2],
  [2, 2, 3, 5, 3],
  [3, 2, 3, 6, 4, 2],
  [4, 2, 4, 7, 4, 3],
  [5, 3, 4, 9, 4, 3, 2],
  [6, 3, 4, 10, 4, 3, 3],
  [7, 3, 4, 11, 4, 3, 3, 1],
  [8, 3, 4, 12, 4, 3, 3, 2],
  [9, 4, 4, 14, 4, 3, 3, 3, 1],
  [10, 4, 5, 15, 4, 3, 3, 3, 2],
  [11, 4, 5, 16, 4, 3, 3, 3, 2, 1],
  [12, 4, 5, 16, 4, 3, 3, 3, 2, 1],
  [13, 5, 5, 17, 4, 3, 3, 3, 2, 1, 1],
  [14, 5, 5, 17, 4, 3, 3, 3, 2, 1, 1],
  [15, 5, 5, 18, 4, 3, 3, 3, 2, 1, 1, 1],
  [16, 5, 5, 18, 4, 3, 3, 3, 2, 1, 1, 1],
  [17, 6, 5, 19, 4, 3, 3, 3, 2, 1, 1, 1, 1],
  [18, 6, 5, 20, 4, 3, 3, 3, 3, 1, 1, 1, 1],
  [19, 6, 5, 21, 4, 3, 3, 3, 3, 2, 1, 1, 1],
  [20, 6, 5, 22, 4, 3, 3, 3, 3, 2, 2, 1, 1],
];

const rows: readonly ClassLevelRow[] = TABLE.map((row) => ({
  level: row[0] ?? 0,
  proficiencyBonus: row[1] ?? 0,
  cantripsKnown: row[2] ?? 0,
  preparedSpells: row[3] ?? 0,
  spellSlots: row.slice(4),
}));

/**
 * SRD Divine Strike: the extra damage dice at each Cleric level.
 *
 * Not a column of the class table — the SRD writes it in the features
 * themselves, 1d8 at level 7 and "increases to 2d8" at 14 — so it is
 * transcribed here rather than read off `TABLE`. Zero below 7, which is what
 * a feature the character does not have yet contributes.
 */
export const DIVINE_STRIKE_DICE: readonly number[] = [
  0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2,
];

/** Cleric Features table, Channel Divinity column. None at level 1. */
export const CLERIC_CHANNEL_DIVINITY: readonly number[] = [
  0, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4,
];

export const CLERIC: ClassDefinition = {
  id: 'cleric',
  name: 'Cleric',
  primaryAbility: 'wis',
  // SRD Cleric: Wisdom, and "you prepare the list of spells that are available
  // for you to cast... choosing from the Cleric spell list". No book.
  spellcasting: { ability: 'wis', style: 'prepared-from-list', progression: 'full', startsAtLevel: 1 },
  hitDie: 8,
  // SRD "As a Multiclass Character": what this class grants when it is not your first.
  multiclass: {
    weapons: [],
    armorTraining: { light: true, medium: true, heavy: false, shields: true },
    tools: [],
  },
  saveProficiencies: ['wis', 'cha'],
  skillChoices: {
    choose: 2,
    from: ['history', 'insight', 'medicine', 'persuasion', 'religion'],
  },
  weaponProficiencies: ['simple'],
  // SRD Core Cleric Traits: "Light and Medium armor and Shields."
  armorTraining: { light: true, medium: true, heavy: false, shields: true },
  subclassLevel: 3,
  table: rows,
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'chain-shirt', quantity: 1 },
        { id: 'shield', quantity: 1 },
        { id: 'mace', quantity: 1 },
        { id: 'holy-symbol', quantity: 1 },
        { id: 'priests-pack', quantity: 1 },
      ],
      goldPieces: 7,
    },
    { option: 'B', items: [], goldPieces: 110 },
  ],
  features: [
    {
      id: 'cleric:spellcasting',
      name: 'Spellcasting',
      level: 1,
      automation: 'engine',
      note: 'Slots and prepared spells are tracked, and preparation is checked against the Cleric spell list rather than a spellbook.',
    },
    {
      id: 'cleric:divine-order',
      name: 'Divine Order',
      level: 1,
      automation: 'manual',
      note: 'Protector grants Martial weapon proficiency and Heavy armor training; Thaumaturge grants an extra cantrip and a Wisdom-modifier bonus to Arcana and Religion checks. Neither is applied: the choice is recorded and a DM applies it.',
      choice: { kind: 'option', choose: 1, from: ['Protector', 'Thaumaturge'] },
    },
    {
      id: 'cleric:channel-divinity',
      name: 'Channel Divinity',
      level: 2,
      automation: 'engine',
      note: 'Declared as a pool sized by the Channel Divinity column, refilling on a Long Rest. A Short Rest gives back one use, which is applied without emptying the pool. What each use buys — Turn Undead, Divine Spark — is not executed.',
      grants: {
        kind: 'pool',
        key: 'channel-divinity',
        label: 'Channel Divinity',
        usesByLevel: CLERIC_CHANNEL_DIVINITY,
        recovers: 'long-rest',
        // SRD: "You regain one expended use when you finish a Short Rest."
        regainsOnShortRest: 1,
      },
    },
    {
      id: 'cleric:subclass',
      name: 'Cleric Subclass',
      level: 3,
      automation: 'engine',
      note: 'The subclass is recorded and its features granted.',
      grantsSubclass: true,
      choice: { kind: 'subclass', choose: 1 },
    },
    {
      id: 'cleric:ability-score-improvement',
      name: 'Ability Score Improvement',
      level: 4,
      automation: 'manual',
      note: 'SRD: "You gain the Ability Score Improvement feat ... or another feat of your choice for which you qualify." The points are the **feat’s** sentence rather than this feature’s — the Ability Score Improvement feat is what prints "Increase one ability score of your choice by 2, or increase two ability scores of your choice by 1" — so granting a feat is the whole of what this feature does, and it does that. What is missing is all on the other side of it. This catalogue publishes no Ability Score Improvement feat; the grant that raises scores exists and the two level 20 capstones carry it, but nothing reads an ability-score grant off a feat, and a feat cannot be asked which scores in the first place — a feat declares what it requires and what it grants, and neither can be a question about an ability. Whether a feat does anything is a property of the feat, not of this feature: Alert’s Initiative Proficiency, Magic Initiate’s spells and free daily casting, and Skilled’s three proficiencies all reach the sheet, while Savage Attacker’s reroll does not. Separately from any of that, the class table grants this feature again at later levels and this catalogue holds one entry for it, so the choice is offered once where the book offers it four times or more.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'cleric:sear-undead',
      name: 'Sear Undead',
      level: 5,
      automation: 'manual',
      note: 'Turn Undead dealing Radiant damage is not modelled; Turn Undead itself is a Channel Divinity option the engine does not execute.',
    },
    {
      id: 'cleric:blessed-strikes',
      name: 'Blessed Strikes',
      level: 7,
      automation: 'engine',
      note: 'Divine Strike is executed: a hit with a weapon deals an extra 1d8, rising to 2d8 at Cleric level 14, of whichever of Necrotic or Radiant the caster names at the hit — once per turn, and naming no type is how the option is declined. Potent Spellcasting is not: adding the Wisdom modifier to a cantrip’s damage is a spell-damage rider rather than an attack one, and a Cleric who chose it gains nothing here.',
      // SRD: "You gain one of the following options of your choice."
      choice: { kind: 'option', choose: 1, from: ['Divine Strike', 'Potent Spellcasting'] },
      grants: {
        kind: 'standing',
        reach: 'self',
        onlyIfChoice: 'Divine Strike',
        // SRD: "Once on each of your turns when you hit a creature with an
        // attack roll using a weapon, you can cause the target to take an
        // extra 1d8 Necrotic or Radiant damage (your choice)."
        effects: [
          {
            kind: 'attack-damage',
            dice: '1d8',
            oncePerTurn: true,
            weaponOnly: true,
            damageTypeChoices: ['necrotic', 'radiant'],
          },
        ],
        diceCountByLevel: DIVINE_STRIKE_DICE,
      },
    },
    {
      id: 'cleric:divine-intervention',
      name: 'Divine Intervention',
      level: 10,
      automation: 'manual',
      note: 'Casting any Cleric spell without components is not modelled, and the once-per-long-rest limit is not tracked.',
    },
    {
      id: 'cleric:improved-blessed-strikes',
      name: 'Improved Blessed Strikes',
      level: 14,
      automation: 'engine',
      executedBy: 'cleric:blessed-strikes',
      note: 'SRD: "The extra damage of your Divine Strike increases to 2d8." The increase is applied by Blessed Strikes’ own dice table, which is read at the character’s Cleric level — this feature is the level at which that table steps, and has no separate effect to execute. The Potent Spellcasting branch’s Temporary Hit Points are not modelled.',
    },
    {
      id: 'cleric:epic-boon',
      name: 'Epic Boon',
      level: 19,
      automation: 'manual',
      note: 'SRD: "You gain an Epic Boon feat ... or another feat of your choice for which you qualify." Every Epic Boon the book prints opens with one mechanical sentence — "Increase one ability score of your choice by 1, to a maximum of 30" — and that sentence is the **boon’s** rather than this feature’s, so granting the feat is the whole of what this feature does. What is missing is the host. This catalogue publishes no Epic Boon feat at all; the grant that lifts one score’s ceiling and no other’s exists and the two level 20 capstones carry it, but nothing reads such a grant off a feat, and a feat cannot be asked which score to raise. So no character of this class reaches level 19. Whether a boon does anything beyond the increase is a property of the boon, not of this feature.',
      choice: { kind: 'feat', choose: 1, category: 'epic-boon' },
    },
    {
      id: 'cleric:greater-divine-intervention',
      name: 'Greater Divine Intervention',
      level: 20,
      automation: 'manual',
      note: 'The Wish effect is not modelled.',
    },
  ],
};

/**
 * SRD "Cleric Subclass: Life Domain" — the subclass the SRD publishes.
 *
 * Its domain spells are the reason a subclass grant had to stop meaning
 * "spellbook entry": these are *always prepared*, from a list the subclass
 * names, and they do not count against what the class table allows.
 */
export const LIFE_DOMAIN: SubclassDefinition = {
  id: 'life-domain',
  name: 'Life Domain',
  classId: 'cleric',
  features: [
    {
      id: 'life-domain:disciple-of-life',
      name: 'Disciple of Life',
      level: 3,
      automation: 'manual',
      note: 'The extra "2 plus the slot level" hit points on a healing spell are not added; healing effects do not yet read the caster’s features.',
    },
    {
      id: 'life-domain:domain-spells',
      name: 'Life Domain Spells',
      level: 3,
      automation: 'engine',
      note: 'The level 3 spells are always prepared and do not count against the class table. The later grants at Cleric levels 5, 7 and 9 are not automatic.',
      grants: {
        kind: 'spells',
        fixed: ['aid', 'bless', 'cure-wounds', 'lesser-restoration'],
      },
    },
    {
      id: 'life-domain:preserve-life',
      name: 'Preserve Life',
      level: 3,
      automation: 'manual',
      note: 'Dividing five times your Cleric level in hit points among Bloodied creatures, capped at half their maximum, is not modelled.',
    },
    {
      id: 'life-domain:blessed-healer',
      name: 'Blessed Healer',
      level: 6,
      automation: 'manual',
      note: 'The caster healing themselves when they heal somebody else is not applied.',
    },
    {
      id: 'life-domain:supreme-healing',
      name: 'Supreme Healing',
      level: 17,
      automation: 'manual',
      note: 'Maximising healing dice rather than rolling them is not applied.',
    },
  ],
};

export const CLERIC_SUBCLASSES: readonly SubclassDefinition[] = [LIFE_DOMAIN];
