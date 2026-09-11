import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from './progression.js';

/**
 * The Barbarian, transcribed from SRD 5.2.1 "Classes".
 *
 * Transcription onto structures that now have several users each, which is
 * what a class should be by this point. The one thing it adds is **Unarmoured
 * Defense** — a class feature that changes Armour Class — and the engine does
 * not apply it, for a reason worth stating rather than hiding: `armorClass`
 * derives from the armour on the sheet and the wearer's Dexterity, and a class
 * feature that replaces that calculation has nowhere to live. A Barbarian's
 * 10 + Dexterity + Constitution is a third formula, and inventing a place for
 * it is a piece of design, not a transcription.
 */

/** Barbarian Features table: level, PB, Rages, Rage Damage, Weapon Mastery. */
const TABLE: readonly (readonly number[])[] = [
  [1, 2, 2, 2, 2],
  [2, 2, 2, 2, 2],
  [3, 2, 3, 2, 2],
  [4, 2, 3, 2, 3],
  [5, 3, 3, 2, 3],
  [6, 3, 4, 2, 3],
  [7, 3, 4, 2, 3],
  [8, 3, 4, 2, 3],
  [9, 4, 4, 3, 3],
  [10, 4, 4, 3, 4],
  [11, 4, 4, 3, 4],
  [12, 4, 5, 3, 4],
  [13, 5, 5, 3, 4],
  [14, 5, 5, 3, 4],
  [15, 5, 5, 3, 4],
  [16, 5, 5, 4, 4],
  [17, 6, 6, 4, 4],
  [18, 6, 6, 4, 4],
  [19, 6, 6, 4, 4],
  [20, 6, 6, 4, 4],
];

const rows: readonly ClassLevelRow[] = TABLE.map((row) => ({
  level: row[0] ?? 0,
  proficiencyBonus: row[1] ?? 0,
}));

/** SRD Rage: uses per Long Rest, and the damage a raging Barbarian adds. */
export const RAGES_PER_REST: readonly number[] = TABLE.map((row) => row[2] ?? 0);
export const RAGE_DAMAGE: readonly number[] = TABLE.map((row) => row[3] ?? 0);

export const BARBARIAN: ClassDefinition = {
  id: 'barbarian',
  name: 'Barbarian',
  primaryAbility: 'str',
  hitDie: 12,
  saveProficiencies: ['str', 'con'],
  skillChoices: {
    choose: 2,
    from: ['animal-handling', 'athletics', 'intimidation', 'nature', 'perception', 'survival'],
  },
  weaponProficiencies: ['simple', 'martial'],
  armorTraining: { light: true, medium: true, heavy: false, shields: true },
  subclassLevel: 3,
  table: rows,
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'greataxe', quantity: 1 },
        { id: 'handaxe', quantity: 4 },
        { id: 'explorers-pack', quantity: 1 },
      ],
      goldPieces: 15,
    },
    { option: 'B', items: [], goldPieces: 75 },
  ],
  features: [
    {
      id: 'barbarian:rage',
      name: 'Rage',
      level: 1,
      automation: 'engine',
      note: 'Declared as a pool of uses refilling on a Long Rest. What Rage does — Resistance to Bludgeoning, Piercing and Slashing, the damage bonus, Advantage on Strength checks and saves — is not applied: a running effect that changes defences needs defences that can change, and they are declared once when a creature is added.',
    },
    {
      id: 'barbarian:unarmored-defense',
      name: 'Unarmored Defense',
      level: 1,
      automation: 'engine',
      note: 'SRD: "While you aren\u2019t wearing any armor, your base Armor Class equals 10 plus your Dexterity and Constitution modifiers. You can use a Shield and still gain this benefit."',
      grants: { kind: 'unarmored-defense', ability: 'con', shieldAllowed: true },
    },
    {
      id: 'barbarian:weapon-mastery',
      name: 'Weapon Mastery',
      level: 1,
      automation: 'manual',
      note: 'Mastery properties are parsed onto weapons but not executed, and which ones a Barbarian has mastery with is recorded nowhere yet.',
    },
    {
      id: 'barbarian:danger-sense',
      name: 'Danger Sense',
      level: 2,
      automation: 'manual',
      note: 'Advantage on Dexterity saves against effects you can see is context the engine does not carry; the roll takes modes from the caller.',
    },
    {
      id: 'barbarian:reckless-attack',
      name: 'Reckless Attack',
      level: 2,
      automation: 'manual',
      note: 'Trading Advantage on your attacks for Advantage on attacks against you is not modelled: nothing holds a per-turn stance that later rolls read.',
    },
    {
      id: 'barbarian:subclass',
      name: 'Barbarian Subclass',
      level: 3,
      automation: 'engine',
      note: 'The subclass is recorded and its features granted.',
      grantsSubclass: true,
      choice: { kind: 'subclass', choose: 1 },
    },
    {
      id: 'barbarian:primal-knowledge',
      name: 'Primal Knowledge',
      level: 3,
      automation: 'engine',
      note: 'One more skill proficiency from the Barbarian list, applied to the sheet.',
      choice: {
        kind: 'skill',
        choose: 1,
        from: ['animal-handling', 'athletics', 'intimidation', 'nature', 'perception', 'survival'],
      },
    },
    {
      id: 'barbarian:ability-score-improvement',
      name: 'Ability Score Improvement',
      level: 4,
      automation: 'manual',
      note: 'Whether a feat does anything is a property of the feat, not of this feature: Alert’s Initiative Proficiency, Magic Initiate’s spells and free daily casting, and Skilled’s three proficiencies all reach the sheet, while Savage Attacker’s reroll does not. What is not modelled here is taking the increase as ability scores rather than as a feat — the choice is always a feat.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'barbarian:extra-attack',
      name: 'Extra Attack',
      level: 5,
      automation: 'manual',
      note: 'The action economy counts one Attack action, not the attacks inside it.',
    },
    {
      id: 'barbarian:fast-movement',
      name: 'Fast Movement',
      level: 5,
      automation: 'manual',
      note: 'The +10 feet of Speed while unarmoured is not applied; Speed comes from the species and nothing modifies it.',
    },
    {
      id: 'barbarian:feral-instinct',
      name: 'Feral Instinct',
      level: 7,
      automation: 'manual',
      note: 'Advantage on Initiative is not applied. `initiativeBonuses` carries flat bonuses a character’s features add; a mode is not a bonus and has no equivalent field.',
    },
    {
      id: 'barbarian:instinctive-pounce',
      name: 'Instinctive Pounce',
      level: 7,
      automation: 'manual',
      note: 'Moving half your Speed when you Rage is not applied, because Rage itself is only a pool.',
    },
    {
      id: 'barbarian:brutal-strike',
      name: 'Brutal Strike',
      level: 9,
      automation: 'manual',
      note: 'Forgoing Advantage for extra damage and a Forceful or Hamstring effect is not modelled.',
    },
    {
      id: 'barbarian:relentless-rage',
      name: 'Relentless Rage',
      level: 11,
      automation: 'manual',
      note: 'Dropping to 1 hit point instead of 0 on a successful save is not modelled: the vitals layer has no hook between damage and unconsciousness.',
    },
    {
      id: 'barbarian:improved-brutal-strike',
      name: 'Improved Brutal Strike',
      level: 13,
      automation: 'manual',
      note: 'More Brutal Strike effects, none of which is modelled.',
    },
    {
      id: 'barbarian:persistent-rage',
      name: 'Persistent Rage',
      level: 15,
      automation: 'manual',
      note: 'Rage lasting ten minutes and refreshing on Initiative is not modelled, because Rage is not a running effect here.',
    },
    {
      id: 'barbarian:improved-brutal-strike-2',
      name: 'Improved Brutal Strike',
      level: 17,
      automation: 'manual',
      note: 'Two Brutal Strike effects at once, neither of which is modelled.',
    },
    {
      id: 'barbarian:indomitable-might',
      name: 'Indomitable Might',
      level: 18,
      automation: 'manual',
      note: 'Treating a Strength check below your Strength score as that score is not applied; the check machinery substitutes nothing.',
    },
    {
      id: 'barbarian:epic-boon',
      name: 'Epic Boon',
      level: 19,
      automation: 'manual',
      note: 'Whether a boon does anything is a property of the boon, not of this feature. No Epic Boon is executed: the SRD’s boons raise an ability score maximum above 20 or grant an effect the engine has no hook for, and the choice is recorded and validated rather than applied.',
      choice: { kind: 'feat', choose: 1, category: 'epic-boon' },
    },
    {
      id: 'barbarian:primal-champion',
      name: 'Primal Champion',
      level: 20,
      automation: 'manual',
      note: 'Raising the Strength and Constitution maximums to 25 is not modelled: ability scores cap at 20 everywhere.',
    },
  ],
};

/** SRD "Barbarian Subclass: Path of the Berserker" — the one the SRD publishes. */
export const PATH_OF_THE_BERSERKER: SubclassDefinition = {
  id: 'path-of-the-berserker',
  name: 'Path of the Berserker',
  classId: 'barbarian',
  features: [
    {
      id: 'berserker:frenzy',
      name: 'Frenzy',
      level: 3,
      automation: 'manual',
      note: 'The extra Necrotic damage while Raging is a bonus the caller supplies; nothing knows a Barbarian is Raging.',
    },
    {
      id: 'berserker:mindless-rage',
      name: 'Mindless Rage',
      level: 6,
      automation: 'manual',
      note: 'Immunity to Charmed and Frightened while Raging is not applied, and ending them when you Rage is not either.',
    },
    {
      id: 'berserker:retaliation',
      name: 'Retaliation',
      level: 10,
      automation: 'manual',
      note: 'A melee attack as a Reaction after taking damage needs an interrupt the engine does not have.',
    },
    {
      id: 'berserker:intimidating-presence',
      name: 'Intimidating Presence',
      level: 14,
      automation: 'manual',
      note: 'The Frightening Emanation is not modelled: an aura that follows a creature is an area nothing keeps running.',
    },
  ],
};

export const BARBARIAN_SUBCLASSES: readonly SubclassDefinition[] = [PATH_OF_THE_BERSERKER];
