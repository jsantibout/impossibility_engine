import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from './progression.js';

/**
 * The Warlock, transcribed from SRD 5.2.1 "Classes".
 *
 * The seventh class, and the only one whose spell slots work differently from
 * everybody else's. **Pact Magic** gives a Warlock very few slots, all at the
 * same level, and gives them back on a **Short Rest** — SRD: "You regain all
 * expended Pact Magic spell slots when you finish a Short or Long Rest."
 *
 * Two slots that come back every hour is a different resource from eight that
 * come back every day, and it is most of what makes a Warlock a Warlock. The
 * engine needed one new field for it: `spellcasting.feature`, which names Pact
 * Magic as the distinct SRD feature it is — its own pool, its own recovery, and
 * out of the Multiclass Spellcaster table. Everything
 * else fitted — the slot table already stores counts per spell level, and "two
 * level 3 slots and nothing below" is `[0, 0, 2]`, which is what the SRD's
 * two-column "Spell Slots / Slot Level" table means when written out.
 *
 * Mystic Arcanum is the other half of the Warlock's casting and is **not**
 * modelled: one free casting each of a level 6, 7, 8 and 9 spell, once per Long
 * Rest, which is four one-use pools attached to spells chosen at those levels.
 * That is a shape the engine does not have, and it says so rather than
 * pretending a Warlock has ninth-level slots.
 */

/**
 * Warlock Features table: level, PB, Invocations, cantrips, prepared, slots,
 * slot level.
 *
 * The last two columns are the unusual pair. Every other class prints a row of
 * counts across nine slot levels; a Warlock prints how many and at what level.
 */
const TABLE: readonly (readonly number[])[] = [
  [1, 2, 1, 2, 2, 1, 1],
  [2, 2, 3, 2, 3, 2, 1],
  [3, 2, 3, 2, 4, 2, 2],
  [4, 2, 3, 3, 5, 2, 2],
  [5, 3, 5, 3, 6, 2, 3],
  [6, 3, 5, 3, 7, 2, 3],
  [7, 3, 6, 3, 8, 2, 4],
  [8, 3, 6, 3, 9, 2, 4],
  [9, 4, 7, 3, 10, 2, 5],
  [10, 4, 7, 4, 10, 2, 5],
  [11, 4, 7, 4, 11, 3, 5],
  [12, 4, 8, 4, 11, 3, 5],
  [13, 5, 8, 4, 12, 3, 5],
  [14, 5, 8, 4, 12, 3, 5],
  [15, 5, 9, 4, 13, 3, 5],
  [16, 5, 9, 4, 13, 3, 5],
  [17, 6, 9, 4, 14, 4, 5],
  [18, 6, 10, 4, 14, 4, 5],
  [19, 6, 10, 4, 15, 4, 5],
  [20, 6, 10, 4, 15, 4, 5],
];

/**
 * "Two slots at level 3" written as the engine stores slots: `[0, 0, 2]`.
 *
 * Zeros below rather than a special case above. A Warlock genuinely has no
 * level 1 or 2 slots once they reach level 5 — their slots *become* level 3 —
 * and every reader of the slot table already handles a zero.
 */
const pactSlots = (count: number, level: number): readonly number[] => {
  const slots = Array.from({ length: level }, () => 0);
  slots[level - 1] = count;
  return slots;
};

const rows: readonly ClassLevelRow[] = TABLE.map((row) => ({
  level: row[0] ?? 0,
  proficiencyBonus: row[1] ?? 0,
  cantripsKnown: row[3] ?? 0,
  preparedSpells: row[4] ?? 0,
  spellSlots: pactSlots(row[5] ?? 0, row[6] ?? 1),
}));

/** SRD Eldritch Invocations known, by level. */
export const ELDRITCH_INVOCATIONS: readonly number[] = TABLE.map((row) => row[2] ?? 0);

export const WARLOCK: ClassDefinition = {
  id: 'warlock',
  name: 'Warlock',
  primaryAbility: 'cha',
  spellcasting: {
    ability: 'cha',
    style: 'known',
    startsAtLevel: 1,
    // The field this class exists to need.
    feature: 'pact-magic',
  },
  hitDie: 8,
  saveProficiencies: ['wis', 'cha'],
  skillChoices: {
    choose: 2,
    from: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion'],
  },
  weaponProficiencies: ['simple'],
  armorTraining: { light: true, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: rows,
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'leather-armor', quantity: 1 },
        { id: 'sickle', quantity: 1 },
        { id: 'dagger', quantity: 2 },
        // SRD prints "Arcane Focus (orb)": the focus row varies in price, and
        // the orb is the variant this package names.
        { id: 'orb', quantity: 1, detail: 'Arcane Focus' },
        { id: 'book', quantity: 1, detail: 'occult lore' },
        { id: 'scholars-pack', quantity: 1 },
      ],
      goldPieces: 15,
    },
    { option: 'B', items: [], goldPieces: 100 },
  ],
  features: [
    {
      id: 'warlock:eldritch-invocations',
      name: 'Eldritch Invocations',
      level: 1,
      automation: 'manual',
      note: 'The number known is on the class table and the invocations themselves are not modelled: each is its own small rule, and several of them grant spells or change how a spell is cast, which the engine would have to execute one at a time.',
    },
    {
      id: 'warlock:pact-magic',
      name: 'Pact Magic',
      level: 1,
      automation: 'engine',
      note: 'Slots are declared at the level the table prints, all at once, and recharge on a Short Rest. Mystic Arcanum is separate and not modelled.',
    },
    {
      id: 'warlock:magical-cunning',
      name: 'Magical Cunning',
      level: 2,
      automation: 'manual',
      note: 'Regaining Pact Magic slots after a one-minute ritual, once per Long Rest, is not modelled; the pool recharges on a rest and nothing else refills it.',
    },
    {
      id: 'warlock:subclass',
      name: 'Warlock Subclass',
      level: 3,
      automation: 'engine',
      note: 'The subclass is recorded and its features granted.',
      grantsSubclass: true,
      choice: { kind: 'subclass', choose: 1 },
    },
    {
      id: 'warlock:ability-score-improvement',
      name: 'Ability Score Improvement',
      level: 4,
      automation: 'manual',
      note: 'Whether a feat does anything is a property of the feat, not of this feature: Alert’s Initiative Proficiency, Magic Initiate’s spells and free daily casting, and Skilled’s three proficiencies all reach the sheet, while Savage Attacker’s reroll does not. What is not modelled here is taking the increase as ability scores rather than as a feat — the choice is always a feat.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'warlock:contact-patron',
      name: 'Contact Patron',
      level: 9,
      automation: 'manual',
      note: 'Contact Other Plane always prepared, and the free casting per Long Rest, are not modelled.',
    },
    {
      id: 'warlock:mystic-arcanum',
      name: 'Mystic Arcanum',
      level: 11,
      automation: 'manual',
      note: 'One free casting each of a level 6, 7, 8 and 9 spell, once per Long Rest, gained at levels 11, 13, 15 and 17. Four one-use pools attached to spells chosen at those levels: a shape the engine does not have, and the reason a Warlock has no high-level slots here.',
    },
    {
      id: 'warlock:epic-boon',
      name: 'Epic Boon',
      level: 19,
      automation: 'manual',
      note: 'Whether a boon does anything is a property of the boon, not of this feature. No Epic Boon is executed: the SRD’s boons raise an ability score maximum above 20 or grant an effect the engine has no hook for, and the choice is recorded and validated rather than applied.',
      choice: { kind: 'feat', choose: 1, category: 'epic-boon' },
    },
    {
      id: 'warlock:eldritch-master',
      name: 'Eldritch Master',
      level: 20,
      automation: 'manual',
      note: 'Regaining all Mystic Arcanum castings on a Long Rest is not modelled, because Mystic Arcanum is not.',
    },
  ],
};

/** SRD "Warlock Subclass: Fiend Patron" — the subclass the SRD publishes. */
export const FIEND_PATRON: SubclassDefinition = {
  id: 'fiend-patron',
  name: 'Fiend Patron',
  classId: 'warlock',
  features: [
    {
      id: 'fiend-patron:dark-ones-blessing',
      name: "Dark One's Blessing",
      level: 3,
      automation: 'manual',
      note: 'Temporary Hit Points when you reduce an enemy to 0 are not granted: nothing watches for a creature dropping and attributes it to a killer.',
    },
    {
      id: 'fiend-patron:fiend-spells',
      name: 'Fiend Spells',
      level: 3,
      automation: 'engine',
      note: 'The level 3 spells are always prepared and do not count against the class table. The later grants at Warlock levels 5 and 7 are not automatic.',
      grants: {
        kind: 'spells',
        fixed: ['burning-hands', 'command', 'scorching-ray', 'suggestion'],
      },
    },
    {
      id: 'fiend-patron:dark-ones-own-luck',
      name: "Dark One's Own Luck",
      level: 6,
      automation: 'manual',
      note: 'Adding 1d10 to an ability check or save after rolling is `interveneAfterRoll`, which exists; nothing spends a Warlock’s uses for it.',
    },
    {
      id: 'fiend-patron:fiendish-resilience',
      name: 'Fiendish Resilience',
      level: 10,
      automation: 'manual',
      note: 'Choosing a damage type to resist after each rest is not modelled: defences are declared when a creature is added and nothing changes them later.',
    },
    {
      id: 'fiend-patron:hurl-through-hell',
      name: 'Hurl Through Hell',
      level: 14,
      automation: 'manual',
      note: 'Banishing a target for a turn and the 8d10 Psychic damage on its return are not modelled; it needs a creature removed from and returned to the battlefield.',
    },
  ],
};

export const WARLOCK_SUBCLASSES: readonly SubclassDefinition[] = [FIEND_PATRON];
