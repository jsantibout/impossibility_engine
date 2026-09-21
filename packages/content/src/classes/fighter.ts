import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from '@ie/engine';

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

/**
 * SRD Indomitable: one use at level 9, "twice before a Long Rest starting at
 * level 13 and three times before a Long Rest starting at level 17".
 *
 * Written out rather than folded into the table above, because it is not a
 * column the SRD prints — the Fighter table names the feature and the
 * sentence carries the count.
 */
export const INDOMITABLE_USES: readonly number[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
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
  // SRD "As a Multiclass Character": what this class grants when it is not your first.
  multiclass: {
    weapons: ['martial'],
    armorTraining: { light: true, medium: true, heavy: false, shields: true },
    tools: [],
  },
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
      note: 'Declared as a pool sized by the Second Wind column, refilling on a Long Rest, with one use back on a Short Rest. Spending a use rolls 1d10, adds the Fighter level and heals — SRD: "As a Bonus Action, you can use it to regain Hit Points equal to 1d10 plus your Fighter level." The Bonus Action is spent in combat, and outside combat there is no economy to spend.',
      grants: {
        kind: 'pool',
        key: 'second-wind',
        label: 'Second Wind',
        usesByLevel: SECOND_WIND_USES,
        recovers: 'long-rest',
        // SRD: "You regain one expended use when you finish a Short Rest."
        regainsOnShortRest: 1,
        // SRD: "regain Hit Points equal to 1d10 plus your Fighter level."
        heals: { action: 'bonus-action', dice: '1d10', plus: 'class-level' },
      },
    },
    {
      id: 'fighter:weapon-mastery',
      name: 'Weapon Mastery',
      level: 1,
      automation: 'engine',
      note: 'SRD: "Your training with weapons allows you to use the mastery properties of three kinds of Simple or Martial weapons of your choice ... as shown in the Weapon Mastery column of the Fighter Features table." Three kinds at level 1 and six at 16, which is the column rather than a number. Executed: the weapons chosen are recorded on the sheet, and the properties that follow from the record run on the attack — Graze\'s damage on a miss, Cleave\'s second swing, Push\'s forced move, Slow\'s ten feet, Topple\'s Constitution save, and Sap and Vex, which the SRD writes as things that simply happen rather than things you can do. Two clauses are still the table\'s: Nick redirects the extra attack the Light property gives, and nothing pays for one; and changing a choice on a Long Rest is an option re-answered, which a choice frozen at creation is not.',
      grants: { kind: 'weapon-mastery' },
      choice: { kind: 'weapon', chooseByLevel: WEAPON_MASTERY_COUNT },
    },
    {
      id: 'fighter:action-surge',
      name: 'Action Surge',
      level: 2,
      automation: 'engine',
      note: 'Declared as a pool of one use, two from Fighter level 17, refilling on a **Short** Rest — SRD: "you can’t do so again until you finish a Short or Long Rest", which is all-or-nothing and so is exactly what the pool system already says. What the use buys is the additional action itself: SRD "On your turn, you can take one additional action, except the Magic action", so the purchase costs nothing to invoke, narrows the action it hands over to everything but the Magic action, and is capped at one a turn — the level 17 sentence, "you can use it twice before a rest but only once on a turn".',
      grants: {
        kind: 'pool',
        key: 'action-surge',
        label: 'Action Surge',
        usesByLevel: ACTION_SURGE_USES,
        recovers: 'short-rest',
        buysBudget: [
          {
            id: 'action-surge',
            name: 'Action Surge',
            // "On your turn, you can take one additional action" — saying so
            // costs nothing; the use is the whole price.
            action: 'none',
            extraAction: { except: ['magic'] },
            // "you can use it twice before a rest but only once on a turn."
            oncePerTurn: true,
          },
        ],
      },
    },
    {
      id: 'fighter:tactical-mind',
      name: 'Tactical Mind',
      level: 2,
      automation: 'engine',
      note: 'SRD: "When you fail an ability check, you can expend a use of your Second Wind to push yourself toward success. Rather than regaining Hit Points, you roll 1d10 and add the number rolled to the ability check... If the check still fails, this use of Second Wind isn’t expended." Peerless Skill’s shape with the Bard’s die swapped for a printed 1d10 and the Bardic Inspiration pool swapped for Second Wind’s: an intervention offered on a failed **check** only, costing no Reaction because the SRD asks for none, and refunded when the new total still misses. "Rather than regaining Hit Points" is the sentence the shared pool already enforces — a use spent here is a use Second Wind’s healing no longer has.',
      grants: {
        kind: 'reaction',
        // No Reaction: the SRD grants it as a bare permission, the way
        // Indomitable and Peerless Skill are granted.
        costsReaction: false,
        reach: { kind: 'self' },
        // Second Wind's own pool, named rather than declared — the move
        // Cutting Words makes on Bardic Inspiration.
        pool: 'second-wind',
        does: [
          {
            kind: 'intervene',
            amount: { dice: '1d10' },
            direction: 'bonus',
            // "When you fail an **ability check**" — and nothing about saves.
            tests: ['ability-check'],
            outcome: 'failure',
            // "If the check still fails, this use ... isn’t expended."
            refundedOnFailure: true,
          },
        ],
      },
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
      automation: 'engine',
      note: 'SRD: "You gain the Ability Score Improvement feat (see “Feats”) or another feat of your choice for which you qualify." Executed, and the points are the feat’s sentence rather than this feature’s: the feature grants a feat, the player names which, and creation applies whatever that feat declares — for the Ability Score Improvement feat, "Increase one ability score of your choice by 2, or increase two ability scores of your choice by 1", whose points land on the scores the player named and stop at the 20 every score keeps. Whether a feat does anything beyond that is a property of the feat and is recorded on the feat. The same paragraph ends with "You gain this feature again at Fighter levels 6, 8, 12, 14, and 16." Each of those levels is an entry of its own here with an id of its own, so the player is offered as many grants as the book offers.',
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
      id: 'fighter:ability-score-improvement-2',
      name: 'Ability Score Improvement',
      level: 6,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Fighter levels 6, 8, 12, 14, and 16." The second of them, at level 6. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as fighter:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'fighter:ability-score-improvement-3',
      name: 'Ability Score Improvement',
      level: 8,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Fighter levels 6, 8, 12, 14, and 16." The third of them, at level 8. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as fighter:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'fighter:indomitable',
      name: 'Indomitable',
      level: 9,
      automation: 'engine',
      note: 'SRD: "If you fail a saving throw, you can reroll it with a bonus equal to your Fighter level. **You must use the new roll**, and you can’t use this feature again until you finish a Long Rest." A pool of uses — one, then two at 13 and three at 17 — and **no Reaction**: the SRD grants it as a bare permission, which is why the window and the action-economy cost are separate facts. A reroll that comes up worse stands; the superseded number stays on the result so the log shows what was given up.',
      grants: {
        kind: 'reaction',
        costsReaction: false,
        reach: { kind: 'self' },
        pool: 'fighter:indomitable',
        poolLabel: 'Indomitable',
        declares: { usesByLevel: INDOMITABLE_USES, recovers: 'long-rest' },
        does: [{ kind: 'reroll', bonus: 'class-level' }],
      },
    },
    {
      id: 'fighter:tactical-master',
      name: 'Tactical Master',
      level: 9,
      automation: 'engine',
      note: 'SRD: "When you attack with a weapon for which you have mastery, you can replace its mastery property with the Push, Sap, or Slow property for that attack." Executed: the three are offered on any attack with a weapon this Fighter has mastery with, in place of whatever the weapon itself prints, and a property this feature does not offer is refused. It is the Improved Critical shape — a later feature restating what an earlier one unlocked — rather than a second record.',
      grants: { kind: 'weapon-mastery', substitutes: ['push', 'sap', 'slow'] },
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
      id: 'fighter:ability-score-improvement-4',
      name: 'Ability Score Improvement',
      level: 12,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Fighter levels 6, 8, 12, 14, and 16." The fourth of them, at level 12. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as fighter:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'fighter:studied-attacks',
      name: 'Studied Attacks',
      level: 13,
      automation: 'manual',
      note: 'Advantage on the next attack after a miss is not tracked between attacks.',
    },
    {
      id: 'fighter:ability-score-improvement-5',
      name: 'Ability Score Improvement',
      level: 14,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Fighter levels 6, 8, 12, 14, and 16." The fifth of them, at level 14. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as fighter:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'fighter:ability-score-improvement-6',
      name: 'Ability Score Improvement',
      level: 16,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Fighter levels 6, 8, 12, 14, and 16." The sixth of them, at level 16. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as fighter:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'fighter:epic-boon',
      name: 'Epic Boon',
      level: 19,
      automation: 'engine',
      note: 'SRD: "You gain an Epic Boon feat (see “Feats”) or another feat of your choice for which you qualify. Boon of Combat Prowess is recommended." Executed: the choice is held to the Epic Boon category, and this catalogue publishes the seven the SRD prints. Every one of them opens with an Ability Score Increase that creation reads — five of them "Increase one ability score of your choice by 1, to a maximum of 30", while Boon of Irresistible Offense narrows the choice to Strength or Dexterity and Boon of Spell Recall to Intelligence, Wisdom or Charisma — so the point lands on the score the player named out of the set that boon offers, and lifts that one score’s ceiling and no other’s. What a boon leaves undone is its own second benefit, which is recorded on the boon rather than here.',
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
          { kind: 'roll-mode', modifier: { mode: 'advantage', selector: { roll: 'initiative', relation: 'roller' } } },
          { kind: 'roll-mode', modifier: { mode: 'advantage', selector: { roll: 'ability-check', relation: 'roller', skill: 'athletics' } } },
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
      note: 'Half of Defy Death is applied, which is why this is not marked as executed. SRD: "You have Advantage on Death Saving Throws" — a death save is its own roll family and `rollTheDeathSave` gathers the standing modes for it, so the Advantage is real. The rest is not: "when you roll 18–20 on a Death Saving Throw, you gain the benefit of rolling a 20 on it" widens the face that counts as a natural 20, which only a Critical Hit has a threshold for, and Heroic Rally’s "regain Hit Points equal to 5 plus your Constitution modifier if you are Bloodied and have at least 1 Hit Point" is healing at a turn boundary that nothing pays out.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          {
            kind: 'roll-mode',
            modifier: { mode: 'advantage', selector: { roll: 'death-save', relation: 'roller' } },
          },
        ],
      },
    },
  ],
};

export const FIGHTER_SUBCLASSES: readonly SubclassDefinition[] = [CHAMPION];
