import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from './progression.js';

/**
 * The Fighter, transcribed from SRD 5.2.1 "Classes".
 *
 * The third class, and the first that **does not cast**. Every spell rule in
 * `creation.ts` had run against two casters and never once against a character
 * with no spellcasting at all, so `spellcasting?: undefined` was a branch the
 * type system allowed and nothing had walked: a class with no cantrips, no
 * prepared list, no slots, and no spellbook.
 *
 * It is also the first class whose table has **no spell slots column**, which
 * is what turned up the difference between "this class has none at this level"
 * and "this class has none ever".
 *
 * Two more firsts worth naming, because both were structures waiting for a
 * user rather than new code:
 *
 * - **Three equipment packages, not two.** A, B or C — the loop never assumed
 *   two, and this is the first thing to prove it.
 * - **A Fighting Style feat.** The category existed on `FeatDefinition` from
 *   the start and no feat was in it; the four SRD ones are registered now, and
 *   the feature's choice names the category, so a Fighter cannot take Alert as
 *   a Fighting Style.
 */

/**
 * Fighter Features table: level, PB, Second Wind uses, Weapon Mastery count.
 *
 * No spell columns, because there are none. `cantripsKnown`, `preparedSpells`
 * and `spellSlots` are all absent rather than zero — a Fighter does not know
 * zero cantrips, a Fighter has no cantrips.
 */
const TABLE: readonly (readonly number[])[] = [
  [1, 2, 2, 3],
  [2, 2, 2, 3],
  [3, 2, 2, 3],
  [4, 2, 3, 4],
  [5, 3, 3, 4],
  [6, 3, 3, 4],
  [7, 3, 3, 4],
  [8, 3, 3, 4],
  [9, 4, 3, 4],
  [10, 4, 4, 5],
  [11, 4, 4, 5],
  [12, 4, 4, 5],
  [13, 5, 4, 5],
  [14, 5, 4, 5],
  [15, 5, 4, 5],
  [16, 5, 4, 6],
  [17, 6, 4, 6],
  [18, 6, 4, 6],
  [19, 6, 4, 6],
  [20, 6, 4, 6],
];

const rows: readonly ClassLevelRow[] = TABLE.map((row) => ({
  level: row[0] ?? 0,
  proficiencyBonus: row[1] ?? 0,
}));

/** Second Wind uses and Weapon Mastery counts, by level, from the same table. */
export const SECOND_WIND_USES: readonly number[] = TABLE.map((row) => row[2] ?? 0);
export const WEAPON_MASTERY_COUNT: readonly number[] = TABLE.map((row) => row[3] ?? 0);

/**
 * SRD Action Surge: one use, and "starting at level 17, you can use it twice".
 * Not a column of the table — the feature says it — so it is written here.
 */
export const ACTION_SURGE_USES: readonly number[] = [
  0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2,
];

export const FIGHTER: ClassDefinition = {
  id: 'fighter',
  name: 'Fighter',
  // SRD prints "Strength or Dexterity". The engine takes one, and Strength is
  // the one the class's own armour and weapon training assume; a Dexterity
  // Fighter is a legal character whose primary ability this does not describe.
  primaryAbility: 'str',
  hitDie: 10,
  saveProficiencies: ['str', 'con'],
  skillChoices: {
    choose: 2,
    from: [
      'acrobatics',
      'animal-handling',
      'athletics',
      'history',
      'insight',
      'intimidation',
      'persuasion',
      'perception',
      'survival',
    ],
  },
  weaponProficiencies: ['simple', 'martial'],
  // SRD Core Fighter Traits: "Light, Medium, and Heavy armor and Shields."
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  subclassLevel: 3,
  table: rows,
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'chain-mail', quantity: 1 },
        { id: 'greatsword', quantity: 1 },
        { id: 'flail', quantity: 1 },
        { id: 'javelin', quantity: 8 },
        { id: 'dungeoneers-pack', quantity: 1 },
      ],
      goldPieces: 4,
    },
    {
      option: 'B',
      items: [
        { id: 'studded-leather-armor', quantity: 1 },
        { id: 'scimitar', quantity: 1 },
        { id: 'shortsword', quantity: 1 },
        { id: 'longbow', quantity: 1 },
        { id: 'arrows', quantity: 20 },
        { id: 'quiver', quantity: 1 },
        { id: 'dungeoneers-pack', quantity: 1 },
      ],
      goldPieces: 11,
    },
    { option: 'C', items: [], goldPieces: 155 },
  ],
  features: [
    {
      id: 'fighter:fighting-style',
      name: 'Fighting Style',
      level: 1,
      automation: 'manual',
      note: 'The chosen Fighting Style feat is recorded and validated against the SRD list. None of the four is applied: every one is a modifier the caller passes to a roll, which is where the engine has always put them.',
      choice: { kind: 'feat', choose: 1, category: 'fighting-style' },
    },
    {
      id: 'fighter:second-wind',
      name: 'Second Wind',
      level: 1,
      automation: 'engine',
      note: 'Declared as a pool sized by the Second Wind column, refilling on a Long Rest. SRD also gives back one use on a Short Rest, which the pool system does not express. The 1d10 plus Fighter level of healing is not spent through the pool: healCreature exists and nothing ties the two together.',
      grants: {
        kind: 'pool',
        key: 'second-wind',
        label: 'Second Wind',
        usesByLevel: SECOND_WIND_USES,
        recovers: 'long-rest',
      },
    },
    {
      id: 'fighter:weapon-mastery',
      name: 'Weapon Mastery',
      level: 1,
      automation: 'manual',
      note: 'The mastery properties (Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex) are parsed onto weapons but not executed, and which weapons a Fighter has mastery with is recorded nowhere yet.',
    },
    {
      id: 'fighter:action-surge',
      name: 'Action Surge',
      level: 2,
      automation: 'engine',
      note: 'Declared as a pool of one use, two from Fighter level 17, refilling on a **Short** Rest — SRD: "you can’t do so again until you finish a Short or Long Rest", which is all-or-nothing and so is exactly what the pool system already says. The extra action itself is not granted: the turn budget holds one action and nothing adds a second.',
      grants: {
        kind: 'pool',
        key: 'action-surge',
        label: 'Action Surge',
        usesByLevel: ACTION_SURGE_USES,
        recovers: 'short-rest',
      },
    },
    {
      id: 'fighter:tactical-mind',
      name: 'Tactical Mind',
      level: 2,
      automation: 'manual',
      note: 'Spending a use of Second Wind to add 1d10 to a failed ability check is not wired to the check machinery.',
    },
    {
      id: 'fighter:subclass',
      name: 'Fighter Subclass',
      level: 3,
      automation: 'engine',
      note: 'The subclass is recorded and its features granted.',
      grantsSubclass: true,
      choice: { kind: 'subclass', choose: 1 },
    },
    {
      id: 'fighter:ability-score-improvement',
      name: 'Ability Score Improvement',
      level: 4,
      automation: 'manual',
      note: 'Whether a feat does anything is a property of the feat, not of this feature: Alert’s Initiative Proficiency, Magic Initiate’s spells and free daily casting, and Skilled’s three proficiencies all reach the sheet, while Savage Attacker’s reroll does not. What is not modelled here is taking the increase as ability scores rather than as a feat — the choice is always a feat.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'fighter:extra-attack',
      name: 'Extra Attack',
      level: 5,
      automation: 'engine',
      note: 'SRD: "You can attack twice instead of once whenever you take the Attack action." The Attack action holds two attacks now rather than costing an action each.',
      grants: { kind: 'extra-attack', attacks: 2 },
    },
    {
      id: 'fighter:tactical-shift',
      name: 'Tactical Shift',
      level: 5,
      automation: 'manual',
      note: 'The free half-Speed move on a Second Wind is not applied.',
    },
    {
      id: 'fighter:indomitable',
      name: 'Indomitable',
      level: 9,
      automation: 'manual',
      note: 'Rerolling a failed save is `rerollTest`, which exists and takes the new roll; nothing spends a Fighter’s uses for it.',
    },
    {
      id: 'fighter:tactical-master',
      name: 'Tactical Master',
      level: 9,
      automation: 'manual',
      note: 'Swapping a weapon’s mastery property for Push, Sap or Slow is not modelled, because mastery properties are not executed.',
    },
    {
      id: 'fighter:two-extra-attacks',
      name: 'Two Extra Attacks',
      level: 11,
      automation: 'engine',
      note: 'SRD: "You can attack three times instead of twice whenever you take the Attack action."',
      grants: { kind: 'extra-attack', attacks: 3 },
    },
    {
      id: 'fighter:studied-attacks',
      name: 'Studied Attacks',
      level: 13,
      automation: 'manual',
      note: 'Advantage on the next attack after a miss is not tracked between attacks.',
    },
    {
      id: 'fighter:epic-boon',
      name: 'Epic Boon',
      level: 19,
      automation: 'manual',
      note: 'Whether a boon does anything is a property of the boon, not of this feature. No Epic Boon is executed: the SRD’s boons raise an ability score maximum above 20 or grant an effect the engine has no hook for, and the choice is recorded and validated rather than applied.',
      choice: { kind: 'feat', choose: 1, category: 'epic-boon' },
    },
    {
      id: 'fighter:three-extra-attacks',
      name: 'Three Extra Attacks',
      level: 20,
      automation: 'engine',
      note: 'SRD: "You can attack four times instead of three whenever you take the Attack action."',
      grants: { kind: 'extra-attack', attacks: 4 },
    },
  ],
};

/** SRD "Fighter Subclass: Champion" — the subclass the SRD publishes. */
export const CHAMPION: SubclassDefinition = {
  id: 'champion',
  name: 'Champion',
  classId: 'fighter',
  features: [
    {
      id: 'champion:improved-critical',
      name: 'Improved Critical',
      level: 3,
      automation: 'engine',
      note: 'SRD: "Your attack rolls with weapons and Unarmed Strikes can score a Critical Hit on a roll of 19 or 20 on the d20." The threshold is on the sheet and `rollAttack` reads it, so a 19 doubles the damage dice — and hits, because the glossary binds the two in one sentence: "you score a Critical Hit, and the attack hits regardless of any modifiers or the target’s AC."',
      grants: { kind: 'critical-range', on: 19 },
    },
    {
      id: 'champion:remarkable-athlete',
      name: 'Remarkable Athlete',
      level: 3,
      automation: 'engine',
      note: 'SRD: "you have Advantage on Initiative rolls and Strength (Athletics) checks." Both are applied — the Initiative roll by rollInitiativeFor and the Athletics check wherever the engine rolls one, which today is the escape a spell offers. The extra running-jump distance is not: jumping is not modelled.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          { kind: 'advantage', on: 'initiative' },
          { kind: 'advantage', on: 'skill', skill: 'athletics' },
        ],
      },
    },
    {
      id: 'champion:additional-fighting-style',
      name: 'Additional Fighting Style',
      level: 7,
      automation: 'manual',
      note: 'A second Fighting Style feat is recorded like the first, and applied no more than the first.',
      choice: { kind: 'feat', choose: 1, category: 'fighting-style' },
    },
    {
      id: 'champion:heroic-warrior',
      name: 'Heroic Warrior',
      level: 10,
      automation: 'manual',
      note: 'Heroic Inspiration during combat is not modelled; Heroic Inspiration itself is not modelled.',
    },
    {
      id: 'champion:superior-critical',
      name: 'Superior Critical',
      level: 15,
      automation: 'engine',
      note: 'SRD: "can now score a Critical Hit on a roll of 18-20 on the d20." The threshold restates the whole rule rather than widening the earlier one, so the lowest grant wins — the same reading Extra Attack takes of its own total.',
      grants: { kind: 'critical-range', on: 18 },
    },
    {
      id: 'champion:survivor',
      name: 'Survivor',
      level: 18,
      automation: 'manual',
      note: 'Advantage on Death Saving Throws and the regeneration while Bloodied are not applied.',
    },
  ],
};

export const FIGHTER_SUBCLASSES: readonly SubclassDefinition[] = [CHAMPION];
