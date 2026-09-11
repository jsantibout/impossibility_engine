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
      note: 'Declared as a pool that recharges on a Short Rest, growing at levels 4, 10 and 16. Spending it to heal 1d10 plus Fighter level is the caller’s: the engine does not roll a pool’s effect for it.',
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
      note: 'Declared as a pool that recharges on a Short Rest. Taking the extra action is a command the caller issues; the pool is what stops it happening twice.',
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
      note: 'Feats are not executed; the chosen feat is recorded only.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'fighter:extra-attack',
      name: 'Extra Attack',
      level: 5,
      automation: 'manual',
      note: 'The action economy counts one Attack action, not the attacks inside it, so a second attack is not enforced or offered.',
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
      automation: 'manual',
      note: 'Same as Extra Attack: the number of attacks inside the Attack action is not modelled.',
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
      note: 'Feats are not executed; the chosen boon is recorded only.',
      choice: { kind: 'feat', choose: 1, category: 'epic-boon' },
    },
    {
      id: 'fighter:three-extra-attacks',
      name: 'Three Extra Attacks',
      level: 20,
      automation: 'manual',
      note: 'Same as Extra Attack.',
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
      automation: 'manual',
      note: 'Scoring a critical on a 19 is not applied: `rollAttack` reads a natural 20 and has no threshold to lower.',
    },
    {
      id: 'champion:remarkable-athlete',
      name: 'Remarkable Athlete',
      level: 3,
      automation: 'manual',
      note: 'Advantage on Initiative and the extra jump distance are not applied.',
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
      automation: 'manual',
      note: 'Critical on an 18 or higher, for the same reason as Improved Critical.',
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
