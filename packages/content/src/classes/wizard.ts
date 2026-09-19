import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from '@ie/engine';

/**
 * The Wizard, transcribed from SRD 5.2.1 "Classes".
 *
 * Hand-written rather than parsed: `classes.md` has no parser, and writing one
 * is a milestone of its own. Transcription hides typos, so the tests assert
 * relationships rather than presence — every printed Proficiency Bonus is
 * checked against the formula, and slots are checked never to go backwards.
 *
 * One class, complete, before a second one starts. The structures in
 * `progression.ts` are the reusable part; this file is the proof they fit
 * something real.
 */

/** Wizard Features table: level, PB, cantrips, prepared, then slots 1-9. */
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
  [14, 5, 5, 18, 4, 3, 3, 3, 2, 1, 1],
  [15, 5, 5, 19, 4, 3, 3, 3, 2, 1, 1, 1],
  [16, 5, 5, 21, 4, 3, 3, 3, 2, 1, 1, 1],
  [17, 6, 5, 22, 4, 3, 3, 3, 2, 1, 1, 1, 1],
  [18, 6, 5, 23, 4, 3, 3, 3, 3, 1, 1, 1, 1],
  [19, 6, 5, 24, 4, 3, 3, 3, 3, 2, 1, 1, 1],
  [20, 6, 5, 25, 4, 3, 3, 3, 3, 2, 2, 1, 1],
];

const rows: readonly ClassLevelRow[] = TABLE.map((row) => ({
  level: row[0] ?? 0,
  proficiencyBonus: row[1] ?? 0,
  cantripsKnown: row[2] ?? 0,
  preparedSpells: row[3] ?? 0,
  spellSlots: row.slice(4),
}));

export const WIZARD: ClassDefinition = {
  id: 'wizard',
  name: 'Wizard',
  primaryAbility: 'int',
  // SRD Wizard: Intelligence, and spells are copied into a book and prepared
  // from it — which is one of three quite different ways a class casts.
  spellcasting: { ability: 'int', style: 'spellbook', progression: 'full', startsAtLevel: 1 },
  hitDie: 6,
  // SRD "As a Multiclass Character": what this class grants when it is not your first.
  multiclass: {
    weapons: [],
    armorTraining: { light: false, medium: false, heavy: false, shields: false },
    tools: [],
  },
  saveProficiencies: ['int', 'wis'],
  skillChoices: {
    choose: 2,
    from: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'nature', 'religion'],
  },
  weaponProficiencies: ['simple'],
  // SRD Core Wizard Traits: "Armor Training: None."
  armorTraining: { light: false, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: rows,
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'dagger', quantity: 2 },
        // SRD prints "Arcane Focus (Quarterstaff)": the focus row varies in
        // price, and the quarterstaff is the variant this package names.
        { id: 'quarterstaff', quantity: 1, detail: 'Arcane Focus' },
        { id: 'robe', quantity: 1 },
        { id: 'spellbook', quantity: 1 },
        { id: 'scholars-pack', quantity: 1 },
      ],
      goldPieces: 5,
    },
    { option: 'B', items: [], goldPieces: 55 },
  ],
  features: [
    {
      id: 'wizard:spellcasting',
      name: 'Spellcasting',
      level: 1,
      automation: 'engine',
      note: 'Slots, prepared spells and the spellbook are tracked; the spells themselves are cast through the casting commands.',
    },
    {
      id: 'wizard:ritual-adept',
      name: 'Ritual Adept',
      level: 1,
      automation: 'manual',
      note: 'Casting from the spellbook as a Ritual is legal through `castSpell` with `slotless: "ritual"`, but the engine does not check that the spell has the Ritual tag or that the book is in hand, and long casting times are refused.',
    },
    {
      id: 'wizard:arcane-recovery',
      name: 'Arcane Recovery',
      level: 1,
      automation: 'engine',
      note: 'Declared as a pool of one use refilling on a Long Rest — the same grant every other class resource now uses, rather than the one feature matched by id. Choosing which slots to recover, and the half-level cap on their total, are the caller’s.',
      grants: {
        kind: 'pool',
        key: 'wizard:arcane-recovery',
        label: 'Arcane Recovery',
        minimum: 1,
        recovers: 'long-rest',
      },
    },
    {
      id: 'wizard:scholar',
      name: 'Scholar',
      level: 2,
      automation: 'engine',
      note: 'Expertise in the chosen skill is applied to the sheet.',
      grants: { kind: 'expertise' },
      choice: {
        kind: 'skill',
        choose: 1,
        from: ['arcana', 'history', 'investigation', 'medicine', 'nature', 'religion'],
      },
    },
    {
      id: 'wizard:subclass',
      name: 'Wizard Subclass',
      level: 3,
      automation: 'engine',
      note: 'The subclass is recorded and its features granted.',
      grantsSubclass: true,
      choice: { kind: 'subclass', choose: 1 },
    },
    {
      id: 'wizard:ability-score-improvement',
      name: 'Ability Score Improvement',
      level: 4,
      automation: 'manual',
      note: 'SRD: "You gain the Ability Score Improvement feat ... or another feat of your choice for which you qualify." The points are the **feat’s** sentence rather than this feature’s — the Ability Score Improvement feat is what prints "Increase one ability score of your choice by 2, or increase two ability scores of your choice by 1" — so granting a feat is the whole of what this feature does, and it does that. What is missing is all on the other side of it. This catalogue publishes no Ability Score Improvement feat; the grant that raises scores exists and the two level 20 capstones carry it, but nothing reads an ability-score grant off a feat, and a feat cannot be asked which scores in the first place — a feat declares what it requires and what it grants, and neither can be a question about an ability. Whether a feat does anything is a property of the feat, not of this feature: Alert’s Initiative Proficiency, Magic Initiate’s spells and free daily casting, and Skilled’s three proficiencies all reach the sheet, while Savage Attacker’s reroll does not. Separately from any of that, the class table grants this feature again at later levels and this catalogue holds one entry for it, so the choice is offered once where the book offers it four times or more.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'wizard:memorize-spell',
      name: 'Memorize Spell',
      level: 5,
      automation: 'manual',
      note: 'Swapping a prepared spell on a Short Rest is not wired into the rest commands.',
    },
    {
      id: 'wizard:spell-mastery',
      name: 'Spell Mastery',
      level: 18,
      automation: 'manual',
      note: 'Casting the chosen spells at will is not modelled.',
    },
    {
      id: 'wizard:epic-boon',
      name: 'Epic Boon',
      level: 19,
      automation: 'manual',
      note: 'SRD: "You gain an Epic Boon feat ... or another feat of your choice for which you qualify." Every Epic Boon the book prints opens with one mechanical sentence — "Increase one ability score of your choice by 1, to a maximum of 30" — and that sentence is the **boon’s** rather than this feature’s, so granting the feat is the whole of what this feature does. What is missing is the host. This catalogue publishes no Epic Boon feat at all; the grant that lifts one score’s ceiling and no other’s exists and the two level 20 capstones carry it, but nothing reads such a grant off a feat, and a feat cannot be asked which score to raise. So no character of this class reaches level 19. Whether a boon does anything beyond the increase is a property of the boon, not of this feature.',
      choice: { kind: 'feat', choose: 1, category: 'epic-boon' },
    },
    {
      id: 'wizard:signature-spells',
      name: 'Signature Spells',
      level: 20,
      automation: 'manual',
      note: 'The free level 3 castings are not modelled.',
    },
  ],
};

/** SRD "Wizard Subclass: Evoker" — the subclass the SRD publishes for Wizards. */
export const EVOKER: SubclassDefinition = {
  id: 'evoker',
  name: 'Evoker',
  classId: 'wizard',
  features: [
    {
      id: 'evoker:evocation-savant',
      name: 'Evocation Savant',
      level: 3,
      automation: 'engine',
      note: 'The two free spells are added to the spellbook. The later "one per new slot level" grant is not automatic.',
      grants: { kind: 'spells' },
      choice: { kind: 'spell', choose: 2, school: 'evocation', maxLevel: 2 },
    },
    {
      id: 'evoker:potent-cantrip',
      name: 'Potent Cantrip',
      level: 3,
      automation: 'manual',
      note: 'Half damage on a missed cantrip attack or a successful save is not applied; the damage pipeline has no notion of a cantrip.',
    },
    {
      id: 'evoker:sculpt-spells',
      name: 'Sculpt Spells',
      level: 6,
      automation: 'manual',
      note: 'Choosing creatures to automatically succeed is not modelled.',
    },
    {
      id: 'evoker:empowered-evocation',
      name: 'Empowered Evocation',
      level: 10,
      automation: 'manual',
      note: 'Adding the Intelligence modifier to an Evocation damage roll is a bonus the caller supplies.',
    },
    {
      id: 'evoker:overchannel',
      name: 'Overchannel',
      level: 14,
      automation: 'manual',
      note: 'Maximised damage and the escalating Necrotic backlash are not modelled.',
    },
  ],
};

export const WIZARD_SUBCLASSES: readonly SubclassDefinition[] = [EVOKER];
