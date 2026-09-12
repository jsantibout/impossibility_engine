import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from './progression.js';

/**
 * The Druid, transcribed from SRD 5.2.1 "Classes".
 *
 * A `prepared-from-list` caster on the full-caster slot table — the same shape
 * as the Cleric, which is the point: the eleventh class needed nothing new.
 *
 * Its subclass is the one that does not fit the grant system, and says so.
 * Circle of the Land's spells are chosen **after a Long Rest** from one of four
 * land types, so they are neither fixed nor a choice made at creation. A
 * `fixed` grant would pick a land for the player; a `choice` would freeze it
 * for the character's whole life. Neither is the rule, so the feature grants
 * nothing and its note says what it would take.
 */

/** Druid Features table: level, PB, Wild Shape, cantrips, prepared, slots 1-9. */
const TABLE: readonly (readonly number[])[] = [
  [1, 2, 0, 2, 4, 2],
  [2, 2, 2, 2, 5, 3],
  [3, 2, 2, 2, 6, 4, 2],
  [4, 2, 2, 3, 7, 4, 3],
  [5, 3, 2, 3, 9, 4, 3, 2],
  [6, 3, 3, 3, 10, 4, 3, 3],
  [7, 3, 3, 3, 11, 4, 3, 3, 1],
  [8, 3, 3, 3, 12, 4, 3, 3, 2],
  [9, 4, 3, 3, 14, 4, 3, 3, 3, 1],
  [10, 4, 3, 4, 15, 4, 3, 3, 3, 2],
  [11, 4, 3, 4, 16, 4, 3, 3, 3, 2, 1],
  [12, 4, 3, 4, 16, 4, 3, 3, 3, 2, 1],
  [13, 5, 3, 4, 17, 4, 3, 3, 3, 2, 1, 1],
  [14, 5, 3, 4, 17, 4, 3, 3, 3, 2, 1, 1],
  [15, 5, 3, 4, 18, 4, 3, 3, 3, 2, 1, 1, 1],
  [16, 5, 3, 4, 18, 4, 3, 3, 3, 2, 1, 1, 1],
  [17, 6, 4, 4, 19, 4, 3, 3, 3, 2, 1, 1, 1, 1],
  [18, 6, 4, 4, 20, 4, 3, 3, 3, 3, 1, 1, 1, 1],
  [19, 6, 4, 4, 21, 4, 3, 3, 3, 3, 2, 1, 1, 1],
  [20, 6, 4, 4, 22, 4, 3, 3, 3, 3, 2, 2, 1, 1],
];

const rows: readonly ClassLevelRow[] = TABLE.map((row) => ({
  level: row[0] ?? 0,
  proficiencyBonus: row[1] ?? 0,
  cantripsKnown: row[3] ?? 0,
  preparedSpells: row[4] ?? 0,
  spellSlots: row.slice(5),
}));

/** SRD Wild Shape: uses per rest, by level. None before level 2. */
export const WILD_SHAPE_USES: readonly number[] = TABLE.map((row) => row[2] ?? 0);

/**
 * SRD Primal Strike: the extra damage dice at each Druid level.
 *
 * Written in the features rather than in a column — 1d8 at level 7, "increases
 * to 2d8" at 15 — so it is transcribed here beside the table it is not part of.
 */
export const PRIMAL_STRIKE_DICE: readonly number[] = [
  0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2,
];

export const DRUID: ClassDefinition = {
  id: 'druid',
  name: 'Druid',
  primaryAbility: 'wis',
  spellcasting: { ability: 'wis', style: 'prepared-from-list', startsAtLevel: 1 },
  hitDie: 8,
  saveProficiencies: ['int', 'wis'],
  skillChoices: {
    choose: 2,
    from: [
      'animal-handling',
      'arcana',
      'insight',
      'medicine',
      'nature',
      'perception',
      'religion',
      'survival',
    ],
  },
  weaponProficiencies: ['simple'],
  armorTraining: { light: true, medium: false, heavy: false, shields: true },
  subclassLevel: 3,
  table: rows,
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'leather-armor', quantity: 1 },
        { id: 'shield', quantity: 1 },
        { id: 'sickle', quantity: 1 },
        // SRD prints "Druidic Focus (Quarterstaff)": the focus row varies in
        // price, and the quarterstaff is the variant this package names.
        { id: 'quarterstaff', quantity: 1, detail: 'Druidic Focus' },
        { id: 'explorers-pack', quantity: 1 },
        { id: 'herbalism-kit', quantity: 1 },
      ],
      goldPieces: 9,
    },
    { option: 'B', items: [], goldPieces: 50 },
  ],
  features: [
    {
      id: 'druid:spellcasting',
      name: 'Spellcasting',
      level: 1,
      automation: 'engine',
      note: 'Slots and prepared spells are tracked, prepared from the Druid list rather than a spellbook.',
    },
    {
      id: 'druid:druidic',
      name: 'Druidic',
      level: 1,
      automation: 'manual',
      note: 'A secret language and the hidden messages it leaves are narration; recorded as a proficiency and read by nobody.',
    },
    {
      id: 'druid:primal-order',
      name: 'Primal Order',
      level: 1,
      automation: 'manual',
      note: 'Magician grants a cantrip and a Wisdom bonus to Arcana and Nature checks; Warden grants Martial weapon proficiency and Medium armour training. Neither is applied: the choice is recorded and a DM applies it.',
      choice: { kind: 'option', choose: 1, from: ['Magician', 'Warden'] },
    },
    {
      id: 'druid:wild-shape',
      name: 'Wild Shape',
      level: 2,
      automation: 'engine',
      note: 'Declared as a pool of uses refilling on a Short Rest. Becoming a Beast is not modelled: it replaces a creature’s whole stat block, and nothing can swap one mid-game.',
    },
    {
      id: 'druid:wild-companion',
      name: 'Wild Companion',
      level: 2,
      automation: 'manual',
      note: 'Spending a Wild Shape use to cast Find Familiar is not modelled; summons are a shape the engine does not have.',
    },
    {
      id: 'druid:subclass',
      name: 'Druid Subclass',
      level: 3,
      automation: 'engine',
      note: 'The subclass is recorded and its features granted.',
      grantsSubclass: true,
      choice: { kind: 'subclass', choose: 1 },
    },
    {
      id: 'druid:ability-score-improvement',
      name: 'Ability Score Improvement',
      level: 4,
      automation: 'manual',
      note: 'Whether a feat does anything is a property of the feat, not of this feature: Alert’s Initiative Proficiency, Magic Initiate’s spells and free daily casting, and Skilled’s three proficiencies all reach the sheet, while Savage Attacker’s reroll does not. What is not modelled here is taking the increase as ability scores rather than as a feat — the choice is always a feat.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'druid:wild-resurgence',
      name: 'Wild Resurgence',
      level: 5,
      automation: 'manual',
      note: 'Trading a Wild Shape use for a level 1 slot, and the reverse, is not modelled: it would mint a slot the class table never printed.',
    },
    {
      id: 'druid:elemental-fury',
      name: 'Elemental Fury',
      level: 7,
      automation: 'engine',
      note: 'Primal Strike is executed: a hit with a weapon deals an extra 1d8, rising to 2d8 at Druid level 15, of whichever of Cold, Fire, Lightning or Thunder the Druid names at the hit — once per turn, and naming no type is how the option is declined. The Beast form’s attack it also covers is not, because Wild Shape is not modelled. Potent Spellcasting is not executed: adding the Wisdom modifier to a cantrip’s damage is a spell-damage rider rather than an attack one.',
      choice: { kind: 'option', choose: 1, from: ['Potent Spellcasting', 'Primal Strike'] },
      grants: {
        kind: 'standing',
        reach: 'self',
        onlyIfChoice: 'Primal Strike',
        // SRD: "Once on each of your turns when you hit a creature with an
        // attack roll using a weapon or a Beast form's attack in Wild Shape,
        // you can cause the target to take an extra 1d8 Cold, Fire, Lightning,
        // or Thunder damage (choose when you hit)."
        effects: [
          {
            kind: 'attack-damage',
            dice: '1d8',
            oncePerTurn: true,
            weaponOnly: true,
            damageTypeChoices: ['cold', 'fire', 'lightning', 'thunder'],
          },
        ],
        diceCountByLevel: PRIMAL_STRIKE_DICE,
      },
    },
    {
      id: 'druid:improved-elemental-fury',
      name: 'Improved Elemental Fury',
      level: 15,
      automation: 'engine',
      note: 'SRD: "The extra damage of your Primal Strike increases to 2d8." The increase is applied by Elemental Fury’s own dice table, read at the character’s Druid level — this feature is the level at which that table steps, and has no separate effect to execute. The Potent Spellcasting branch’s 300 feet of extra cantrip range is not modelled.',
    },
    {
      id: 'druid:beast-spells',
      name: 'Beast Spells',
      level: 18,
      automation: 'manual',
      note: 'Casting while Wild Shaped is not modelled, because Wild Shape is not.',
    },
    {
      id: 'druid:epic-boon',
      name: 'Epic Boon',
      level: 19,
      automation: 'manual',
      note: 'Whether a boon does anything is a property of the boon, not of this feature. No Epic Boon is executed: the SRD’s boons raise an ability score maximum above 20 or grant an effect the engine has no hook for, and the choice is recorded and validated rather than applied.',
      choice: { kind: 'feat', choose: 1, category: 'epic-boon' },
    },
    {
      id: 'druid:archdruid',
      name: 'Archdruid',
      level: 20,
      automation: 'manual',
      note: 'Unlimited Wild Shape, the slot recovery and the extended lifespan are not modelled.',
    },
  ],
};

/** SRD "Druid Subclass: Circle of the Land" — the subclass the SRD publishes. */
export const CIRCLE_OF_THE_LAND: SubclassDefinition = {
  id: 'circle-of-the-land',
  name: 'Circle of the Land',
  classId: 'druid',
  features: [
    {
      id: 'circle-of-the-land:spells',
      name: 'Circle of the Land Spells',
      level: 3,
      automation: 'manual',
      note: 'The land spells are **not** granted. SRD: "Whenever you finish a Long Rest, choose one type of land" — arid, polar, temperate or tropical — and the spells follow the choice. A fixed grant would pick a land for the player, and a creation-time choice would freeze it for life; neither is the rule. It needs a grant that can be re-chosen on a rest, which is a rest mechanic rather than a creation one.',
    },
  ],
};

export const DRUID_SUBCLASSES: readonly SubclassDefinition[] = [CIRCLE_OF_THE_LAND];
