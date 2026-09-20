import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from '@ie/engine';

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

/** SRD Weapon Mastery: the Barbarian Features table's own column. */
export const BARBARIAN_WEAPON_MASTERY_COUNT: readonly number[] = TABLE.map((row) => row[4] ?? 0);

export const BARBARIAN: ClassDefinition = {
  id: 'barbarian',
  name: 'Barbarian',
  primaryAbility: 'str',
  hitDie: 12,
  // SRD "As a Multiclass Character": what this class grants when it is not your first.
  multiclass: {
    weapons: ['martial'],
    armorTraining: { light: false, medium: false, heavy: false, shields: true },
    tools: [],
  },
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
      note: 'Entered as a Bonus Action out of a pool sized by the Rages column, lasting until the end of your next turn unless extended, and ending the moment you are Incapacitated or don Heavy armour. Resistance to Bludgeoning, Piercing and Slashing and Advantage on Strength checks and saves are applied while it runs. Rage Damage is applied too, as a bonus to the weapon’s own damage on any attack made with Strength. The Short Rest that gives back one use is applied too — a partial refill the pool system expresses now that five features asked for it.',
      grants: {
        kind: 'activated',
        action: 'bonus-action',
        pool: 'rage',
        usesByLevel: RAGES_PER_REST,
        poolLabel: 'Rage',
        recovers: 'long-rest',
        // SRD: "You regain one expended use when you finish a Short Rest, and you
        // regain all expended uses when you finish a Long Rest."
        regainsOnShortRest: 1,
        lasts: 'end-of-next-turn',
        // SRD: "You can maintain a Rage for up to 10 minutes."
        capSeconds: 600,
        endsOn: ['incapacitated', 'heavy-armor'],
        forbidsCasting: true,
        whileActive: [
          { kind: 'damage-resistance', damageTypes: ['bludgeoning', 'piercing', 'slashing'] },
          { kind: 'roll-mode', modifier: { mode: 'advantage', selector: { roll: 'saving-throw', relation: 'roller', ability: 'str' } } },
          // SRD: "a bonus to the damage" — the weapon's own type, so a target
          // resisting the sword resists this with it. The amount is a column.
          { kind: 'attack-damage', usingAbility: 'str' },
        ],
        flatByLevel: RAGE_DAMAGE,
      },
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
      automation: 'engine',
      note: 'SRD: "Your training with weapons allows you to use the mastery properties of two kinds of Simple or Martial Melee weapons of your choice ... When you reach certain Barbarian levels, you gain the ability to use the mastery properties of more kinds of weapons, as shown in the Weapon Mastery column of the Barbarian Features table." The count is the column and the narrowing to Melee is this class’s alone. Executed: the weapons chosen are recorded on the sheet, and the properties that follow from the record run on the attack — Graze\'s damage on a miss, Cleave\'s second swing, Push\'s forced move, Slow\'s ten feet, Topple\'s Constitution save, and Sap and Vex, which the SRD writes as things that simply happen rather than things you can do. Two clauses are still the table\'s: Nick redirects the extra attack the Light property gives, and nothing pays for one; and changing a choice on a Long Rest is an option re-answered, which a choice frozen at creation is not.',
      grants: { kind: 'weapon-mastery' },
      choice: { kind: 'weapon', chooseByLevel: BARBARIAN_WEAPON_MASTERY_COUNT, melee: true },
    },
    {
      id: 'barbarian:danger-sense',
      name: 'Danger Sense',
      level: 2,
      automation: 'engine',
      note: 'SRD: "You have Advantage on Dexterity saving throws unless you have the Incapacitated condition." Applied from state on every Dexterity save, so being Stunned takes it away without anything having to remember to.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          { kind: 'roll-mode', modifier: { mode: 'advantage', selector: { roll: 'saving-throw', relation: 'roller', ability: 'dex' } } },
        ],
        requires: [{ kind: 'not-incapacitated' }],
      },
    },
    {
      id: 'barbarian:reckless-attack',
      name: 'Reckless Attack',
      level: 2,
      automation: 'manual',
      note: 'Not applied, and the stance is no longer the reason: an activated feature runs to the start of the holder’s next turn, grants standing effects while it runs, and may cost no action and no use at all. What no grant can say is the narrowing. SRD: "Doing so gives you Advantage on attack rolls using Strength" — a `RollSelector` allows an ability only on an ability check and a saving throw, because an SRD attack roll is not a Strength attack roll in the language Advantage is granted in, so the mode would reach every swing the Barbarian makes. The other half, "attack rolls against you have Advantage", is `against-holder` and is expressible today.',
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
      automation: 'engine',
      note: 'SRD: "You gain the Ability Score Improvement feat (see “Feats”) or another feat of your choice for which you qualify." Executed, and the points are the feat’s sentence rather than this feature’s: the feature grants a feat, the player names which, and creation applies whatever that feat declares — for the Ability Score Improvement feat, "Increase one ability score of your choice by 2, or increase two ability scores of your choice by 1", whose points land on the scores the player named and stop at the 20 every score keeps. Whether a feat does anything beyond that is a property of the feat and is recorded on the feat. The same paragraph ends with "You gain this feature again at Barbarian levels 8, 12, and 16." Each of those levels is an entry of its own here with an id of its own, so the player is offered as many grants as the book offers.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'barbarian:extra-attack',
      name: 'Extra Attack',
      level: 5,
      automation: 'engine',
      note: 'SRD: "You can attack twice instead of once whenever you take the Attack action." The Attack action holds two attacks now rather than costing an action each.',
      grants: { kind: 'extra-attack', attacks: 2 },
    },
    {
      id: 'barbarian:fast-movement',
      name: 'Fast Movement',
      level: 5,
      automation: 'engine',
      note: 'SRD: "Your speed increases by 10 feet while you aren’t wearing Heavy armor." Applied by speedOf, which is the one place the command layer asks what a creature’s Speed is — so it reaches the movement allowance, the Dash and the mounting cost together. Note Heavy armour and not "unarmoured": a chain shirt keeps the ten feet.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'speed', feet: 10 }],
        requires: [{ kind: 'not-wearing-heavy-armor' }],
      },
    },
    {
      id: 'barbarian:feral-instinct',
      name: 'Feral Instinct',
      level: 7,
      automation: 'engine',
      note: 'SRD: "Your instincts are so honed that you have Advantage on Initiative rolls." Applied by rollInitiativeFor, off the creature’s own features rather than out of a caller’s hand — the same rule Alert’s Proficiency Bonus already follows.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'roll-mode', modifier: { mode: 'advantage', selector: { roll: 'initiative', relation: 'roller' } } }],
      },
    },
    {
      id: 'barbarian:instinctive-pounce',
      name: 'Instinctive Pounce',
      level: 7,
      automation: 'manual',
      note: 'Moving half your Speed when you Rage is not applied. Rage is a whole activated feature now rather than a pool, and the half that is still missing is the move: `moveCreature` is a command somebody takes, and no feature hands its holder a move that costs nothing out of the turn’s allowance.',
    },
    {
      id: 'barbarian:ability-score-improvement-2',
      name: 'Ability Score Improvement',
      level: 8,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Barbarian levels 8, 12, and 16." The second of them, at level 8. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as barbarian:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'barbarian:brutal-strike',
      name: 'Brutal Strike',
      level: 9,
      automation: 'manual',
      note: 'Not applied, and it needs Reckless Attack before anything else. Forgoing a mode you were granted is a price no feature can pay; Forceful Blow pushes the target fifteen feet and then moves the Barbarian half their Speed toward it, and no feature reaches either; and Hamstring Blow reduces a Speed, which the Speed grant deliberately leaves to the condition layer.',
    },
    {
      id: 'barbarian:relentless-rage',
      name: 'Relentless Rage',
      level: 11,
      automation: 'manual',
      note: 'Dropping to 1 hit point instead of 0 on a successful save is not modelled: the vitals layer has no hook between damage and unconsciousness.',
    },
    {
      id: 'barbarian:ability-score-improvement-3',
      name: 'Ability Score Improvement',
      level: 12,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Barbarian levels 8, 12, and 16." The third of them, at level 12. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as barbarian:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'barbarian:improved-brutal-strike',
      name: 'Improved Brutal Strike',
      level: 13,
      automation: 'manual',
      note: 'Two more Brutal Strike options, and lengthening another feature’s list is itself a restatement the engine has no member for. Neither option is modelled either: Staggering Blow gives the target Disadvantage on its next saving throw and stops its Opportunity Attacks until the start of your next turn, and Sundering Blow gives the next attack roll another creature makes against the target a bonus of five.',
    },
    {
      id: 'barbarian:persistent-rage',
      name: 'Persistent Rage',
      level: 15,
      automation: 'manual',
      note: 'Half of it is applied, which is why this is not marked as executed. SRD: "When you roll Initiative, you can regain all expended uses of Rage. After you regain uses of Rage in this way, you can’t do so again until you finish a Long Rest" — Uncanny Metabolism’s sentence with the Monk’s pool swapped for the Rages column and the healing left off, so it is a recovery grant with a pool of one behind it. The other half is not: "your Rage is so fierce that it now lasts for 10 minutes without you needing to do anything to extend it from round to round" and the ending "if you have the Unconscious condition (not just the Incapacitated condition) or don Heavy armor" are a feature rewriting another feature’s activation, and an `ActivatedFeature`’s deadline, cap and exits are fixed when the sheet is built.',
      grants: {
        kind: 'recovery',
        // The feature's own once-per-Long-Rest limit, which is a pool of one.
        pool: 'barbarian:persistent-rage',
        poolLabel: 'Persistent Rage',
        restores: { kind: 'pool', key: 'rage' },
        upTo: 'all',
        moment: 'initiative',
      },
    },
    {
      id: 'barbarian:ability-score-improvement-4',
      name: 'Ability Score Improvement',
      level: 16,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Barbarian levels 8, 12, and 16." The fourth of them, at level 16. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as barbarian:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'barbarian:improved-brutal-strike-2',
      name: 'Improved Brutal Strike',
      level: 17,
      automation: 'manual',
      note: 'Nothing here is its own mechanism: the extra damage steps to 2d10 and two Brutal Strike effects may be used at once, both of which are this feature rewriting the level 9 one. `executedBy` is the member for an Improved X that only raises a number, and it is refused against a feature that declares nothing — which Brutal Strike does not, because none of it is built.',
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
      automation: 'engine',
      note: 'SRD: "You gain an Epic Boon feat (see “Feats”) or another feat of your choice for which you qualify. Boon of Irresistible Offense is recommended." Executed: the choice is held to the Epic Boon category, and this catalogue publishes the seven the SRD prints. Every one of them opens with an Ability Score Increase that creation reads — five of them "Increase one ability score of your choice by 1, to a maximum of 30", while Boon of Irresistible Offense narrows the choice to Strength or Dexterity and Boon of Spell Recall to Intelligence, Wisdom or Charisma — so the point lands on the score the player named out of the set that boon offers, and lifts that one score’s ceiling and no other’s. What a boon leaves undone is its own second benefit, which is recorded on the boon rather than here.',
      choice: { kind: 'feat', choose: 1, category: 'epic-boon' },
    },
    {
      id: 'barbarian:primal-champion',
      name: 'Primal Champion',
      level: 20,
      automation: 'engine',
      note: 'SRD: "Your Strength and Constitution scores increase by 4, to a maximum of 25." Both halves are applied: the four points land on each of the two scores, and 25 is the ceiling for those two and for no others — a Barbarian’s Dexterity still stops at 20.',
      grants: {
        kind: 'ability-score-increase',
        raises: [
          { ability: 'str', points: 4 },
          { ability: 'con', points: 4 },
        ],
        maximum: 25,
      },
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
      note: 'Not applied, and being inside a Rage is no longer the reason: a standing effect may require a named feature to be active, which is how Mindless Rage reads the Barbarian’s own Rage. What blocks this one is Reckless Attack. SRD: "If you use Reckless Attack while your Rage is active, you deal extra damage to the first target you hit on your turn with a Strength-based attack" — Reckless Attack is manual because no selector can narrow an attack roll to the ability it was made with, so there is no stance here for a requirement to read.',
    },
    {
      id: 'berserker:mindless-rage',
      name: 'Mindless Rage',
      level: 6,
      automation: 'manual',
      note: 'The immunity is applied: SRD, "You have Immunity to the Charmed and Frightened conditions while your Rage is active", as suppression while the Rage runs. The other sentence is not \u2014 "If you\u2019re Charmed or Frightened when you enter your Rage, the condition ends on you" removes the condition outright, and the difference shows only in a narrow case: a Barbarian Charmed before raging finds the charm still on them when the Rage ends, where the SRD would have ended it.',
      grants: {
        kind: 'standing',
        reach: 'self',
        requires: [{ kind: 'feature-active', feature: 'barbarian:rage' }],
        effects: [
          { kind: 'condition-immunity', condition: 'charmed' },
          { kind: 'condition-immunity', condition: 'frightened' },
        ],
      },
    },
    {
      id: 'berserker:retaliation',
      name: 'Retaliation',
      level: 10,
      automation: 'engine',
      note: 'SRD: "When you take damage from a creature that is within 5 feet of you, you can take a Reaction to make one melee attack against that creature, using a weapon or an Unarmed Strike." The window is the one *Hellish Rebuke* already answers — damage that has **landed** — so nothing is held open and no pending state exists: everything is settled and the Reaction cannot change it. The target is forced by the trigger, and the swing goes through the ordinary attack command.',
      grants: {
        kind: 'reaction',
        costsReaction: true,
        reach: { kind: 'self' },
        does: [{ kind: 'melee-attack', withinFeet: 5 }],
      },
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
