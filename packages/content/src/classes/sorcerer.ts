import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from '@ie/engine';

/**
 * The Sorcerer, transcribed from SRD 5.2.1 "Classes".
 *
 * The fourth class, and the last of the three spellcasting styles: a Sorcerer
 * **knows** their spells and never prepares them. SRD's 2024 table calls the
 * column "Prepared Spells" for every caster, but the Sorcerer's text is
 * explicit that the list changes only when they level or take a Long Rest to
 * swap one — so `style: 'known'` records that the count is a *known* list
 * rather than a morning's preparation, and the distinction is a rest rule
 * rather than a creation rule.
 *
 * It also brings the first **Metamagic**, which is the `option` choice kind
 * doing exactly what Divine Order did — a set of named things, none of them
 * feats — and the first class whose subclass grants spells that are *not* on
 * its own list: Draconic Sorcery's Command is a Cleric spell.
 */

/** Sorcerer Features table: level, PB, Sorcery Points, cantrips, known, slots 1-9. */
const TABLE: readonly (readonly number[])[] = [
  [1, 2, 0, 4, 2, 2],
  [2, 2, 2, 4, 4, 3],
  [3, 2, 3, 4, 6, 4, 2],
  [4, 2, 4, 5, 7, 4, 3],
  [5, 3, 5, 5, 9, 4, 3, 2],
  [6, 3, 6, 5, 10, 4, 3, 3],
  [7, 3, 7, 5, 11, 4, 3, 3, 1],
  [8, 3, 8, 5, 12, 4, 3, 3, 2],
  [9, 4, 9, 5, 14, 4, 3, 3, 3, 1],
  [10, 4, 10, 6, 15, 4, 3, 3, 3, 2],
  [11, 4, 11, 6, 16, 4, 3, 3, 3, 2, 1],
  [12, 4, 12, 6, 16, 4, 3, 3, 3, 2, 1],
  [13, 5, 13, 6, 17, 4, 3, 3, 3, 2, 1, 1],
  [14, 5, 14, 6, 17, 4, 3, 3, 3, 2, 1, 1],
  [15, 5, 15, 6, 18, 4, 3, 3, 3, 2, 1, 1, 1],
  [16, 5, 16, 6, 18, 4, 3, 3, 3, 2, 1, 1, 1],
  [17, 6, 17, 6, 19, 4, 3, 3, 3, 2, 1, 1, 1, 1],
  [18, 6, 18, 6, 20, 4, 3, 3, 3, 3, 1, 1, 1, 1],
  [19, 6, 19, 6, 21, 4, 3, 3, 3, 3, 2, 1, 1, 1],
  [20, 6, 20, 6, 22, 4, 3, 3, 3, 3, 2, 2, 1, 1],
];

const rows: readonly ClassLevelRow[] = TABLE.map((row) => ({
  level: row[0] ?? 0,
  proficiencyBonus: row[1] ?? 0,
  cantripsKnown: row[3] ?? 0,
  preparedSpells: row[4] ?? 0,
  spellSlots: row.slice(5),
}));

/** SRD Font of Magic: Sorcery Points equal to Sorcerer level, from level 2. */
export const SORCERY_POINTS: readonly number[] = TABLE.map((row) => row[2] ?? 0);

/** SRD "Metamagic Options" — the ten the SRD publishes. */
export const METAMAGIC_OPTIONS: readonly string[] = [
  'Careful Spell',
  'Distant Spell',
  'Empowered Spell',
  'Extended Spell',
  'Heightened Spell',
  'Quickened Spell',
  'Seeking Spell',
  'Subtle Spell',
  'Transmuted Spell',
  'Twinned Spell',
];

export const SORCERER: ClassDefinition = {
  id: 'sorcerer',
  name: 'Sorcerer',
  primaryAbility: 'cha',
  // SRD Sorcerer: Charisma, and the spell list is *known* rather than prepared.
  spellcasting: { ability: 'cha', style: 'known', progression: 'full', startsAtLevel: 1 },
  hitDie: 6,
  // SRD "As a Multiclass Character": what this class grants when it is not your first.
  multiclass: {
    weapons: [],
    armorTraining: { light: false, medium: false, heavy: false, shields: false },
    tools: [],
  },
  saveProficiencies: ['con', 'cha'],
  skillChoices: {
    choose: 2,
    from: ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion'],
  },
  weaponProficiencies: ['simple'],
  // SRD Core Sorcerer Traits: "Armor Training: None."
  armorTraining: { light: false, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: rows,
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'spear', quantity: 1 },
        { id: 'dagger', quantity: 2 },
        // SRD prints "Arcane Focus (crystal)": the focus row varies in price,
        // and the crystal is the variant this package names.
        { id: 'crystal', quantity: 1, detail: 'Arcane Focus' },
        { id: 'dungeoneers-pack', quantity: 1 },
      ],
      goldPieces: 28,
    },
    { option: 'B', items: [], goldPieces: 50 },
  ],
  features: [
    {
      id: 'sorcerer:spellcasting',
      name: 'Spellcasting',
      level: 1,
      automation: 'engine',
      note: 'Slots and the known spell list are tracked. A Sorcerer never prepares: the list changes on levelling or by swapping one on a Long Rest, and the swap is not wired to the rest commands.',
    },
    {
      id: 'sorcerer:innate-sorcery',
      name: 'Innate Sorcery',
      level: 1,
      automation: 'manual',
      note: 'The +1 to spell save DC and Advantage on spell attacks for one minute are not applied, and the twice-per-long-rest limit is not tracked.',
    },
    {
      id: 'sorcerer:font-of-magic',
      name: 'Font of Magic',
      level: 2,
      automation: 'engine',
      note: 'Sorcery Points are declared as a pool sized by the class table, refilling on a Long Rest — SRD: "You regain all expended Sorcery Points when you finish a Long Rest." Converting them into spell slots and back is not modelled: it would mint a slot the class table never printed.',
      grants: {
        kind: 'pool',
        key: 'sorcery-points',
        label: 'Sorcery Points',
        usesByLevel: SORCERY_POINTS,
        recovers: 'long-rest',
      },
    },
    {
      id: 'sorcerer:metamagic',
      name: 'Metamagic',
      level: 2,
      automation: 'manual',
      note: 'Two options are chosen and recorded, and more at levels 10 and 17. None is executed; Empowered Spell is `rerollDice` in the dice layer, which a caller opts into per roll.',
      choice: { kind: 'option', choose: 2, from: METAMAGIC_OPTIONS },
    },
    {
      id: 'sorcerer:subclass',
      name: 'Sorcerer Subclass',
      level: 3,
      automation: 'engine',
      note: 'The subclass is recorded and its features granted.',
      grantsSubclass: true,
      choice: { kind: 'subclass', choose: 1 },
    },
    {
      id: 'sorcerer:ability-score-improvement',
      name: 'Ability Score Improvement',
      level: 4,
      automation: 'manual',
      note: 'SRD: "You gain the Ability Score Improvement feat ... or another feat of your choice for which you qualify." The points are the **feat’s** sentence rather than this feature’s — the Ability Score Improvement feat is what prints "Increase one ability score of your choice by 2, or increase two ability scores of your choice by 1" — so granting a feat is the whole of what this feature does, and it does that. The vocabulary the feat would need exists: a choice that spreads points over one score or two, and a grant that raises scores, which the two level 20 capstones carry. What is missing is on the other side of the feature: this catalogue publishes no Ability Score Improvement feat, and nothing reads an ability-score grant off a feat. Whether a feat does anything is a property of the feat, not of this feature: Alert’s Initiative Proficiency, Magic Initiate’s spells and free daily casting, and Skilled’s three proficiencies all reach the sheet, while Savage Attacker’s reroll does not. The class table grants this feature again at later levels and this catalogue holds one entry for it, so the choice is offered once.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'sorcerer:sorcerous-restoration',
      name: 'Sorcerous Restoration',
      level: 5,
      automation: 'engine',
      note: 'SRD: "When you finish a Short Rest, you can regain expended Sorcery Points, but no more than a number equal to half your Sorcerer level (round down). Once you use this feature, you can’t do so again until you finish a Long Rest." The cap is derived at the moment of use, the moment is checked against the rest that just finished, and the daily limit is a pool of one.',
      grants: {
        kind: 'recovery',
        pool: 'sorcerer:sorcerous-restoration',
        poolLabel: 'Sorcerous Restoration',
        restores: { kind: 'pool', key: 'sorcery-points' },
        upTo: 'half-class-level',
        moment: 'short-rest',
      },
    },
    {
      id: 'sorcerer:sorcery-incarnate',
      name: 'Sorcery Incarnate',
      level: 7,
      automation: 'manual',
      note: 'Using two Metamagic options on one spell, and spending Sorcery Points to use Innate Sorcery again, are not modelled.',
    },
    {
      id: 'sorcerer:epic-boon',
      name: 'Epic Boon',
      level: 19,
      automation: 'manual',
      note: 'SRD: "You gain an Epic Boon feat ... or another feat of your choice for which you qualify." Every Epic Boon the book prints opens with one mechanical sentence — "Increase one ability score of your choice by 1, to a maximum of 30" — and that sentence is the **boon’s** rather than this feature’s, so granting the feat is the whole of what this feature does. The vocabulary the boon would need exists: a choice that raises one score, and a grant that lifts that score’s ceiling and no other’s, which the two level 20 capstones carry. What is missing is the host — this catalogue publishes no Epic Boon feat at all, and nothing reads such a grant off a feat — so no character of this class reaches level 19. Whether a boon does anything beyond the increase is a property of the boon, not of this feature.',
      choice: { kind: 'feat', choose: 1, category: 'epic-boon' },
    },
    {
      id: 'sorcerer:arcane-apotheosis',
      name: 'Arcane Apotheosis',
      level: 20,
      automation: 'manual',
      note: 'The free Metamagic option during Innate Sorcery is not modelled.',
    },
  ],
};

/**
 * SRD "Sorcerer Subclass: Draconic Sorcery" — the subclass the SRD publishes.
 *
 * Its level 3 spells include Command, which is a **Cleric** spell. That is the
 * point of a granted spell not being checked against the class list: a domain
 * or bloodline grant exists precisely to hand over something the class could
 * not otherwise cast.
 */
export const DRACONIC_SORCERY: SubclassDefinition = {
  id: 'draconic-sorcery',
  name: 'Draconic Sorcery',
  classId: 'sorcerer',
  features: [
    {
      id: 'draconic-sorcery:draconic-resilience',
      name: 'Draconic Resilience',
      level: 3,
      automation: 'manual',
      note: 'The Armour Class half is applied: SRD, "While you aren’t wearing armor, your base Armor Class equals 10 plus your Dexterity and Charisma modifiers." The hit point half is not — "your Hit Point maximum increases by 3, and it increases by 1 whenever you gain another Sorcerer level" needs a feature that raises the hit point maximum, which nothing else wants yet.',
      grants: { kind: 'unarmored-defense', ability: 'cha', shieldAllowed: true },
    },
    {
      id: 'draconic-sorcery:draconic-spells',
      name: 'Draconic Spells',
      level: 3,
      automation: 'engine',
      note: 'The level 3 spells are always prepared and do not count against the class table. The later grants at Sorcerer levels 5 and 7 are not automatic.',
      grants: {
        kind: 'spells',
        fixed: ['alter-self', 'chromatic-orb', 'command', 'dragons-breath'],
      },
    },
    {
      id: 'draconic-sorcery:elemental-affinity',
      name: 'Elemental Affinity',
      level: 6,
      automation: 'manual',
      note: 'The Resistance is applied: SRD, "Choose one of those types: Acid, Cold, Fire, Lightning, or Poison. You have Resistance to that damage type." Its text names no condition, so a Stunned Sorcerer still resists. The other half is not applied — "when you cast a spell that deals damage of that type, you can add your Charisma modifier to one damage roll of that spell" needs a hook into a spell’s own damage roll, which no other feature wants yet.',
      choice: { kind: 'option', choose: 1, from: ['Acid', 'Cold', 'Fire', 'Lightning', 'Poison'] },
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'damage-resistance', damageTypes: [] }],
        damageTypesFromChoice: true,
      },
    },
    {
      id: 'draconic-sorcery:dragon-wings',
      name: 'Dragon Wings',
      level: 14,
      automation: 'manual',
      note: 'A Fly Speed is not modelled: movement has one speed and no modes.',
    },
    {
      id: 'draconic-sorcery:dragon-companion',
      name: 'Dragon Companion',
      level: 18,
      automation: 'manual',
      note: 'Summoning a Dragon is not modelled; summons are a shape the engine does not have.',
    },
  ],
};

export const SORCERER_SUBCLASSES: readonly SubclassDefinition[] = [DRACONIC_SORCERY];
