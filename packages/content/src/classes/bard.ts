import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from '@ie/engine';

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
  spellcasting: { ability: 'cha', style: 'known', progression: 'full', startsAtLevel: 1 },
  hitDie: 8,
  // SRD "As a Multiclass Character": what this class grants when it is not your first.
  multiclass: {
    weapons: [],
    armorTraining: { light: true, medium: false, heavy: false, shields: false },
    skills: { choose: 1 },
    tools: ['Musical Instrument'],
  },
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
      note: 'Declared as a pool of Charisma-modifier uses, minimum one, refilling on a Long Rest — SRD: "a number of times equal to your Charisma modifier (minimum of once)". Cutting Words and Peerless Skill spend those uses now, in the `test-rolled` and `damage-rolled` windows. What is still missing is **conferring** a die: SRD gives the die to another creature, who holds it for an hour and spends it on their own failed D20 Test with no Reaction and no help from the Bard, and nothing models a resource one creature hands to another.',
      grants: {
        kind: 'pool',
        key: 'bardic-inspiration',
        label: 'Bardic Inspiration',
        fromAbilityModifier: 'cha',
        minimum: 1,
        recovers: 'long-rest',
      },
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
      automation: 'engine',
      note: 'SRD: "You gain the Ability Score Improvement feat (see “Feats”) or another feat of your choice for which you qualify." Executed, and the points are the feat’s sentence rather than this feature’s: the feature grants a feat, the player names which, and creation applies whatever that feat declares — for the Ability Score Improvement feat, "Increase one ability score of your choice by 2, or increase two ability scores of your choice by 1", whose points land on the scores the player named and stop at the 20 every score keeps. Whether a feat does anything beyond that is a property of the feat and is recorded on the feat. The same paragraph ends with "You gain this feature again at Bard levels 8, 12, and 16." Each of those levels is an entry of its own here with an id of its own, so the player is offered as many grants as the book offers.',
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
      note: 'SRD: "If you or a creature within 30 feet of you fails a saving throw against an effect that applies the Charmed or Frightened condition, you can take a Reaction to cause the save to be rerolled, and the new roll has Advantage." The `test-rolled` window and the reroll both exist \u2014 Indomitable uses them. Two things do not: a spell rolls its targets\u2019 saves inside one atomic resolution, so there is no such save to hold open, and nothing records **what a save was against**, which is the whole of the Charmed-or-Frightened clause.',
    },
    {
      id: 'bard:ability-score-improvement-2',
      name: 'Ability Score Improvement',
      level: 8,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Bard levels 8, 12, and 16." The second of them, at level 8. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as bard:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
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
      id: 'bard:ability-score-improvement-3',
      name: 'Ability Score Improvement',
      level: 12,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Bard levels 8, 12, and 16." The third of them, at level 12. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as bard:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'bard:ability-score-improvement-4',
      name: 'Ability Score Improvement',
      level: 16,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Bard levels 8, 12, and 16." The fourth of them, at level 16. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as bard:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
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
      automation: 'engine',
      note: 'SRD: "You gain an Epic Boon feat (see “Feats”) or another feat of your choice for which you qualify. Boon of Spell Recall is recommended." Executed: the choice is held to the Epic Boon category, this catalogue publishes the seven the SRD prints, and each opens with "Increase one ability score of your choice by 1, to a maximum of 30" — a grant creation reads, so the point lands on the score the player named and lifts that one score’s ceiling and no other’s. What a boon leaves undone is its own second benefit, which is recorded on the boon rather than here.',
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
      automation: 'engine',
      note: 'SRD: "When a creature that you can see within 60 feet of yourself makes a damage roll or succeeds on an ability check or attack roll, you can take a Reaction to expend one use of your Bardic Inspiration; roll your Bardic Inspiration die, and subtract the number rolled from the creature’s roll." One feature answering two windows, so it declares two effects and is offered at both. The attack-roll branch is not reachable: `resolveAttack` settles its roll in one breath and only its **damage** is held open, so a Bard cuts the blow rather than the swing.',
      grants: {
        kind: 'reaction',
        costsReaction: true,
        // "a creature that you can see **within 60 feet of yourself**".
        reach: { kind: 'within', feet: 60 },
        requiresSight: true,
        pool: 'bardic-inspiration',
        does: [
          { kind: 'reduce-damage', amount: { diceByLevel: BARDIC_DIE } },
          {
            kind: 'intervene',
            amount: { diceByLevel: BARDIC_DIE },
            direction: 'penalty',
            // "**succeeds on** an ability check or attack roll" — a failure
            // is nothing to cut, and the attack-roll half is unreachable.
            tests: ['ability-check'],
            outcome: 'success',
          },
        ],
      },
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
      automation: 'engine',
      note: 'SRD: "When you make an ability check or attack roll and fail, you can expend one use of Bardic Inspiration; roll the Bardic Inspiration die, and add the number rolled to the d20... **On a failure, the Bardic Inspiration isn’t expended.**" The refund is the point: the only feature here whose cost depends on whether it worked, so the use is spent after the new total is known. It costs no Reaction, which is why the window and the action-economy cost are separate facts. The attack-roll half is unreachable, as for Cutting Words.',
      grants: {
        kind: 'reaction',
        costsReaction: false,
        reach: { kind: 'self' },
        pool: 'bardic-inspiration',
        does: [
          {
            kind: 'intervene',
            amount: { diceByLevel: BARDIC_DIE },
            direction: 'bonus',
            tests: ['ability-check'],
            outcome: 'failure',
            refundedOnFailure: true,
          },
        ],
      },
    },
  ],
};

export const BARD_SUBCLASSES: readonly SubclassDefinition[] = [COLLEGE_OF_LORE];
