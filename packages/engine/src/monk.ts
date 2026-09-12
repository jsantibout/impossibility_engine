import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from './progression.js';

/**
 * The Monk, transcribed from SRD 5.2.1 "Classes".
 *
 * The second class with Unarmoured Defense and a different formula for it —
 * 10 + Dexterity + Wisdom, where a Barbarian's is Constitution. Two classes
 * wanting the same missing hook is worth more than one: it says the gap is a
 * *shape* (a class feature that replaces the Armour Class calculation) rather
 * than a Barbarian quirk, and that is how it is recorded in PROGRESS.md.
 *
 * Martial Arts is a die that grows with level rather than a number, so it is
 * exported as notation and pinned by a test — the same treatment Sneak Attack
 * gets, because a growth table is exactly what a transcription gets wrong.
 */

/** Monk Features table: level, PB, Martial Arts die, Focus Points, movement. */
const TABLE: readonly (readonly number[])[] = [
  [1, 2, 6, 0, 0],
  [2, 2, 6, 2, 10],
  [3, 2, 6, 3, 10],
  [4, 2, 6, 4, 10],
  [5, 3, 8, 5, 10],
  [6, 3, 8, 6, 15],
  [7, 3, 8, 7, 15],
  [8, 3, 8, 8, 15],
  [9, 4, 8, 9, 15],
  [10, 4, 8, 10, 20],
  [11, 4, 10, 11, 20],
  [12, 4, 10, 12, 20],
  [13, 5, 10, 13, 20],
  [14, 5, 10, 14, 25],
  [15, 5, 10, 15, 25],
  [16, 5, 10, 16, 25],
  [17, 6, 12, 17, 25],
  [18, 6, 12, 18, 30],
  [19, 6, 12, 19, 30],
  [20, 6, 12, 20, 30],
];

const rows: readonly ClassLevelRow[] = TABLE.map((row) => ({
  level: row[0] ?? 0,
  proficiencyBonus: row[1] ?? 0,
}));

/** SRD Martial Arts: the die a Monk's unarmed strike deals, by level. */
export const MARTIAL_ARTS_DIE: readonly string[] = TABLE.map((row) => `1d${row[2] ?? 6}`);
/** SRD Monk's Focus: Focus Points, by level. None before level 2. */
export const FOCUS_POINTS: readonly number[] = TABLE.map((row) => row[3] ?? 0);
/** SRD Unarmored Movement: extra Speed in feet, by level. */
export const UNARMORED_MOVEMENT: readonly number[] = TABLE.map((row) => row[4] ?? 0);

export const MONK: ClassDefinition = {
  id: 'monk',
  name: 'Monk',
  // SRD prints "Dexterity and Wisdom". The engine takes one; Dexterity is what
  // Martial Arts and Unarmoured Defense both read first.
  primaryAbility: 'dex',
  hitDie: 8,
  saveProficiencies: ['str', 'dex'],
  skillChoices: {
    choose: 2,
    from: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth'],
  },
  // SRD: "Simple weapons and Martial weapons that have the Light property."
  // The qualified half is a category the engine records and does not evaluate.
  weaponProficiencies: ['simple', 'martial-light'],
  armorTraining: { light: false, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: rows,
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'spear', quantity: 1 },
        { id: 'dagger', quantity: 5 },
        { id: 'explorers-pack', quantity: 1 },
      ],
      goldPieces: 11,
    },
    { option: 'B', items: [], goldPieces: 50 },
  ],
  features: [
    {
      id: 'monk:martial-arts',
      name: 'Martial Arts',
      level: 1,
      automation: 'manual',
      note: 'The growing unarmed damage die, using Dexterity for unarmed strikes, and the Bonus Action unarmed strike are not applied: the attack layer reads a weapon or the fixed Unarmed Strike, and has no notion of a class changing either.',
    },
    {
      id: 'monk:unarmored-defense',
      name: 'Unarmored Defense',
      level: 1,
      automation: 'engine',
      note: 'SRD: "While you aren’t wearing armor or wielding a Shield, your base Armor Class equals 10 plus your Dexterity and Wisdom modifiers." The Shield clause takes the whole calculation away, not just the Shield’s bonus.',
      grants: { kind: 'unarmored-defense', ability: 'wis', shieldAllowed: false },
    },
    {
      id: 'monk:focus',
      name: "Monk's Focus",
      level: 2,
      automation: 'engine',
      note: 'Focus Points are declared as a pool refilling on a Short Rest. Flurry of Blows, Patient Defense and Step of the Wind are what a point buys, and none is modelled.',
    },
    {
      id: 'monk:unarmored-movement',
      name: 'Unarmored Movement',
      level: 2,
      automation: 'manual',
      note: 'The extra Speed while unarmoured is not applied; Speed comes from the species and nothing modifies it.',
    },
    {
      id: 'monk:uncanny-metabolism',
      name: 'Uncanny Metabolism',
      level: 2,
      automation: 'manual',
      note: 'Regaining all Focus Points and rolling the Martial Arts die for healing on Initiative is not modelled.',
    },
    {
      id: 'monk:deflect-attacks',
      name: 'Deflect Attacks',
      level: 3,
      automation: 'manual',
      note: 'Reducing damage with a Reaction needs an interrupt the engine does not have; `reduceDamage` exists and nothing triggers it.',
    },
    {
      id: 'monk:subclass',
      name: 'Monk Subclass',
      level: 3,
      automation: 'engine',
      note: 'The subclass is recorded and its features granted.',
      grantsSubclass: true,
      choice: { kind: 'subclass', choose: 1 },
    },
    {
      id: 'monk:ability-score-improvement',
      name: 'Ability Score Improvement',
      level: 4,
      automation: 'manual',
      note: 'Whether a feat does anything is a property of the feat, not of this feature: Alert’s Initiative Proficiency, Magic Initiate’s spells and free daily casting, and Skilled’s three proficiencies all reach the sheet, while Savage Attacker’s reroll does not. What is not modelled here is taking the increase as ability scores rather than as a feat — the choice is always a feat.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'monk:slow-fall',
      name: 'Slow Fall',
      level: 4,
      automation: 'manual',
      note: 'Reducing falling damage is not modelled; falling is not modelled.',
    },
    {
      id: 'monk:extra-attack',
      name: 'Extra Attack',
      level: 5,
      automation: 'engine',
      note: 'SRD: "You can attack twice instead of once whenever you take the Attack action." The Attack action holds two attacks now rather than costing an action each.',
      grants: { kind: 'extra-attack', attacks: 2 },
    },
    {
      id: 'monk:stunning-strike',
      name: 'Stunning Strike',
      level: 5,
      automation: 'manual',
      note: 'Spending a Focus Point to force a Constitution save or Stun is not wired: the Stunned condition exists and applying it is the caller’s.',
    },
    {
      id: 'monk:empowered-strikes',
      name: 'Empowered Strikes',
      level: 6,
      automation: 'manual',
      note: 'Choosing Force damage for unarmed strikes is not applied, because unarmed strikes are not a class-modified attack here.',
    },
    {
      id: 'monk:evasion',
      name: 'Evasion',
      level: 7,
      automation: 'engine',
      note: 'SRD: \"When you’re subjected to an effect that allows you to make a Dexterity saving throw to take only half damage, you instead take no damage if you succeed on the saving throw and only half damage if you fail.\" Applied by the save-for-damage path, read off the target’s own features. It bites only where the effect already offers half on a success: Sacred Flame offers nothing, and Evasion says nothing about it. The Incapacitated clause is this feature’s own and is declared on it.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'evasion' }],
        // SRD Monk: "You can't use this feature if you have the Incapacitated
        // condition." The Rogue's Evasion says no such thing, which is why the
        // requirement is declared per feature rather than assumed.
        requires: [{ kind: 'not-incapacitated' }],
      },
    },
    {
      id: 'monk:acrobatic-movement',
      name: 'Acrobatic Movement',
      level: 9,
      automation: 'manual',
      note: 'Moving along vertical surfaces and across liquids is not modelled; movement has one speed and no modes.',
    },
    {
      id: 'monk:heightened-focus',
      name: 'Heightened Focus',
      level: 10,
      automation: 'manual',
      note: 'Improved Flurry of Blows, Patient Defense and Step of the Wind, none of which is modelled.',
    },
    {
      id: 'monk:self-restoration',
      name: 'Self-Restoration',
      level: 10,
      automation: 'manual',
      note: 'Ending the Charmed, Frightened or Poisoned condition at the end of your turn is not applied; the turn boundary raises saves, not condition removals.',
    },
    {
      id: 'monk:deflect-energy',
      name: 'Deflect Energy',
      level: 13,
      automation: 'manual',
      note: 'Deflecting any damage type, for the same reason as Deflect Attacks.',
    },
    {
      id: 'monk:disciplined-survivor',
      name: 'Disciplined Survivor',
      level: 14,
      automation: 'manual',
      note: 'Proficiency in every save, and rerolling a failed one for a Focus Point, are not applied; save proficiencies are a fixed list on the class.',
    },
    {
      id: 'monk:perfect-focus',
      name: 'Perfect Focus',
      level: 15,
      automation: 'manual',
      note: 'Regaining Focus Points on Initiative when low is not modelled.',
    },
    {
      id: 'monk:superior-defense',
      name: 'Superior Defense',
      level: 18,
      automation: 'manual',
      note: 'Resistance to all damage but Force for a minute is not applied: defences are declared once and do not change.',
    },
    {
      id: 'monk:epic-boon',
      name: 'Epic Boon',
      level: 19,
      automation: 'manual',
      note: 'Whether a boon does anything is a property of the boon, not of this feature. No Epic Boon is executed: the SRD’s boons raise an ability score maximum above 20 or grant an effect the engine has no hook for, and the choice is recorded and validated rather than applied.',
      choice: { kind: 'feat', choose: 1, category: 'epic-boon' },
    },
    {
      id: 'monk:body-and-mind',
      name: 'Body and Mind',
      level: 20,
      automation: 'manual',
      note: 'Raising Dexterity and Wisdom by 4, to a maximum of 25, is not modelled: ability scores cap at 20 everywhere.',
    },
  ],
};

/** SRD "Monk Subclass: Warrior of the Open Hand" — the one the SRD publishes. */
export const WARRIOR_OF_THE_OPEN_HAND: SubclassDefinition = {
  id: 'warrior-of-the-open-hand',
  name: 'Warrior of the Open Hand',
  classId: 'monk',
  features: [
    {
      id: 'open-hand:technique',
      name: 'Open Hand Technique',
      level: 3,
      automation: 'manual',
      note: 'Addle, Push and Topple on a Flurry of Blows hit are not modelled, because Flurry of Blows is not.',
    },
    {
      id: 'open-hand:wholeness-of-body',
      name: 'Wholeness of Body',
      level: 6,
      automation: 'manual',
      note: 'Healing yourself as a Bonus Action, Wisdom-modifier times per Long Rest, is not modelled as its own pool.',
    },
    {
      id: 'open-hand:fleet-step',
      name: 'Fleet Step',
      level: 11,
      automation: 'manual',
      note: 'A free Step of the Wind alongside another Bonus Action is not modelled.',
    },
    {
      id: 'open-hand:quivering-palm',
      name: 'Quivering Palm',
      level: 17,
      automation: 'manual',
      note: 'The delayed lethal vibrations are not modelled: an effect that waits days for a trigger has no home in the duration system, which measures elapsed time and turn boundaries.',
    },
  ],
};

export const MONK_SUBCLASSES: readonly SubclassDefinition[] = [WARRIOR_OF_THE_OPEN_HAND];
