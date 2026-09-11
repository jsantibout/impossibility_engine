import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from './progression.js';

/**
 * The Bard, transcribed from SRD 5.2.1 "Classes".
 *
 * A `known` caster on the full-caster slot table, and the **third** class with
 * Expertise — twice, at levels 2 and 9, from any skill the character has.
 *
 * Its one genuinely odd trait is `skillChoices`: SRD says "Choose any 3
 * skills", where every other class names a list. `SkillChoices.from` had to
 * become optional for it — absent meaning "any", rather than a copy of the
 * whole skill list, because those are different rules and only one of them
 * survives the game gaining a skill.
 */

/** Bard Features table: level, PB, Bardic die, cantrips, prepared, slots 1-9. */
const TABLE: readonly (readonly number[])[] = [
  [1, 2, 6, 2, 4, 2],
  [2, 2, 6, 2, 5, 3],
  [3, 2, 6, 2, 6, 4, 2],
  [4, 2, 6, 3, 7, 4, 3],
  [5, 3, 8, 3, 9, 4, 3, 2],
  [6, 3, 8, 3, 10, 4, 3, 3],
  [7, 3, 8, 3, 11, 4, 3, 3, 1],
  [8, 3, 8, 3, 12, 4, 3, 3, 2],
  [9, 4, 8, 3, 14, 4, 3, 3, 3, 1],
  [10, 4, 10, 4, 15, 4, 3, 3, 3, 2],
  [11, 4, 10, 4, 16, 4, 3, 3, 3, 2, 1],
  [12, 4, 10, 4, 16, 4, 3, 3, 3, 2, 1],
  [13, 5, 10, 4, 17, 4, 3, 3, 3, 2, 1, 1],
  [14, 5, 10, 4, 17, 4, 3, 3, 3, 2, 1, 1],
  [15, 5, 12, 4, 18, 4, 3, 3, 3, 2, 1, 1, 1],
  [16, 5, 12, 4, 18, 4, 3, 3, 3, 2, 1, 1, 1],
  [17, 6, 12, 4, 19, 4, 3, 3, 3, 2, 1, 1, 1, 1],
  [18, 6, 12, 4, 20, 4, 3, 3, 3, 3, 1, 1, 1, 1],
  [19, 6, 12, 4, 21, 4, 3, 3, 3, 3, 2, 1, 1, 1],
  [20, 6, 12, 4, 22, 4, 3, 3, 3, 3, 2, 2, 1, 1],
];

const rows: readonly ClassLevelRow[] = TABLE.map((row) => ({
  level: row[0] ?? 0,
  proficiencyBonus: row[1] ?? 0,
  cantripsKnown: row[3] ?? 0,
  preparedSpells: row[4] ?? 0,
  spellSlots: row.slice(5),
}));

/** SRD Bardic Inspiration: the die, which grows at levels 5, 10 and 15. */
export const BARDIC_DIE: readonly string[] = TABLE.map((row) => `1d${row[2] ?? 6}`);

export const BARD: ClassDefinition = {
  id: 'bard',
  name: 'Bard',
  primaryAbility: 'cha',
  spellcasting: { ability: 'cha', style: 'known', startsAtLevel: 1 },
  hitDie: 8,
  saveProficiencies: ['dex', 'cha'],
  // SRD: "Choose any 3 skills." An absent `from` means any skill — and it had
  // to be made optional for this, which is what a twelfth class is for.
  skillChoices: { choose: 3 },
  weaponProficiencies: ['simple'],
  armorTraining: { light: true, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: rows,
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'leather-armor', quantity: 1 },
        { id: 'dagger', quantity: 2 },
        { id: 'lute', quantity: 1, detail: 'Musical Instrument of your choice' },
        { id: 'entertainers-pack', quantity: 1 },
      ],
      goldPieces: 19,
    },
    { option: 'B', items: [], goldPieces: 90 },
  ],
  features: [
    {
      id: 'bard:bardic-inspiration',
      name: 'Bardic Inspiration',
      level: 1,
      automation: 'engine',
      note: 'Declared as a pool of Charisma-modifier uses refilling on a Long Rest. Handing the die to somebody who has already rolled is `interveneAfterRoll`, which exists; nothing spends a Bard’s uses for it.',
    },
    {
      id: 'bard:spellcasting',
      name: 'Spellcasting',
      level: 1,
      automation: 'engine',
      note: 'Slots and the known spell list are tracked. A Bard never prepares: the list changes on levelling or by swapping one on a Long Rest, and the swap is not wired to the rest commands.',
    },
    {
      id: 'bard:expertise',
      name: 'Expertise',
      level: 2,
      automation: 'engine',
      note: 'Expertise in the two chosen skills is applied to the sheet. A second pair arrives at Bard level 9.',
      grants: { kind: 'expertise' },
      choice: { kind: 'skill', choose: 2 },
    },
    {
      id: 'bard:jack-of-all-trades',
      name: 'Jack of All Trades',
      level: 2,
      automation: 'manual',
      note: 'Half the Proficiency Bonus on a check using no skill proficiency is not applied. Note that 2024 excludes Initiative from it — Initiative uses no skill at all — which is the opposite of the 2014 reading.',
    },
    {
      id: 'bard:subclass',
      name: 'Bard Subclass',
      level: 3,
      automation: 'engine',
      note: 'The subclass is recorded and its features granted.',
      grantsSubclass: true,
      choice: { kind: 'subclass', choose: 1 },
    },
    {
      id: 'bard:ability-score-improvement',
      name: 'Ability Score Improvement',
      level: 4,
      automation: 'manual',
      note: 'Feats are not executed; the chosen feat is recorded only.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'bard:font-of-inspiration',
      name: 'Font of Inspiration',
      level: 5,
      automation: 'manual',
      note: 'Regaining Bardic Inspiration on a Short Rest, and spending a slot to regain a use, are not wired to the rest commands.',
    },
    {
      id: 'bard:countercharm',
      name: 'Countercharm',
      level: 7,
      automation: 'manual',
      note: 'Granting Advantage on a save against Charmed or Frightened as a Reaction needs an interrupt the engine does not have.',
    },
    {
      id: 'bard:second-expertise',
      name: 'Expertise',
      level: 9,
      automation: 'engine',
      note: 'Expertise in two more skills, applied the same way as the first pair.',
      grants: { kind: 'expertise' },
      choice: { kind: 'skill', choose: 2 },
    },
    {
      id: 'bard:magical-secrets',
      name: 'Magical Secrets',
      level: 10,
      automation: 'manual',
      note: 'Drawing known spells from the Cleric, Druid and Wizard lists as well as the Bard’s is not modelled: a known spell is checked against one class list.',
    },
    {
      id: 'bard:superior-inspiration',
      name: 'Superior Inspiration',
      level: 18,
      automation: 'manual',
      note: 'Regaining Bardic Inspiration uses on Initiative is not modelled.',
    },
    {
      id: 'bard:epic-boon',
      name: 'Epic Boon',
      level: 19,
      automation: 'manual',
      note: 'Feats are not executed; the chosen boon is recorded only.',
      choice: { kind: 'feat', choose: 1, category: 'epic-boon' },
    },
    {
      id: 'bard:words-of-creation',
      name: 'Words of Creation',
      level: 20,
      automation: 'manual',
      note: 'Power Word Heal and Power Word Kill always prepared, and their doubled targets, are not modelled.',
    },
  ],
};

/** SRD "Bard Subclass: College of Lore" — the subclass the SRD publishes. */
export const COLLEGE_OF_LORE: SubclassDefinition = {
  id: 'college-of-lore',
  name: 'College of Lore',
  classId: 'bard',
  features: [
    {
      id: 'college-of-lore:bonus-proficiencies',
      name: 'Bonus Proficiencies',
      level: 3,
      automation: 'engine',
      note: 'Three more skill proficiencies, applied to the sheet like any other skill choice.',
      choice: { kind: 'skill', choose: 3 },
    },
    {
      id: 'college-of-lore:cutting-words',
      name: 'Cutting Words',
      level: 3,
      automation: 'manual',
      note: 'Subtracting the Bardic Inspiration die from somebody else’s roll is `interveneAfterRoll` with a penalty direction, and `reduceDamage` for a damage roll. Both exist; nothing spends a Bard’s uses for them, and the Reaction timing is not enforced.',
    },
    {
      id: 'college-of-lore:magical-discoveries',
      name: 'Magical Discoveries',
      level: 6,
      automation: 'manual',
      note: 'Two spells from the Cleric, Druid or Wizard lists are not modelled, for the same reason as Magical Secrets.',
    },
    {
      id: 'college-of-lore:peerless-skill',
      name: 'Peerless Skill',
      level: 14,
      automation: 'manual',
      note: 'Spending Bardic Inspiration on your own failed check or attack is `interveneAfterRoll`; nothing spends the uses.',
    },
  ],
};

export const BARD_SUBCLASSES: readonly SubclassDefinition[] = [COLLEGE_OF_LORE];
