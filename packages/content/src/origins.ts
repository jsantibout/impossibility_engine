/**
 * SRD 5.2.1 species, backgrounds, feats, languages and alignments,
 * transcribed as data.
 *
 * Every species and background the SRD prints is here, transcribed from
 * `packages/srd/raw/character-origins.md` sentence by sentence. Much of what a
 * species trait does is still a mechanic the engine has never had — a breath
 * weapon, a lineage's spells, a Hit Point maximum that grows — so many of
 * these features are `manual` and each note says what the DM is left holding
 * and why. A trait that is one of the shapes already built is wired to it,
 * and Darkvision became one of those the day a sense got a grant kind.
 */
import type {
  AlignmentDefinition,
  BackgroundDefinition,
  FeatDefinition,
  FeatureOptionMeaning,
  GatedFeatureGrant,
  LanguageDefinition,
  SpeciesDefinition,
} from '@ie/engine';

/**
 * A table of options against the damage type each one names, as a feature's
 * `optionMeans` — the second column of a table the SRD prints beside a choice.
 *
 * Two species print one: the Draconic Ancestors and the Fiendish Legacies. The
 * shape is the engine's and the rows are the book's, which is the whole of the
 * split: a trait written as "the damage type determined by your X trait" reads
 * the choice made on X and looks the option up here.
 */
const meansDamage = (
  table: Readonly<Record<string, string>>,
): Readonly<Record<string, FeatureOptionMeaning>> =>
  Object.fromEntries(
    Object.entries(table).map(([option, type]) => [option, { damageTypes: [type] }]),
  );

/**
 * SRD Draconic Ancestors: the ten dragons the table prints and the damage type
 * beside each, in the book's own order.
 *
 * **Both columns, because both are now read.** The types used to be left out
 * on purpose — a grant took its damage types only from a choice made on its
 * own feature, the Damage Resistance trait is a different feature from the one
 * that chooses a dragon, and "listing the types here would be a table with no
 * reader". A grant can now name the sibling whose choice it reads and look the
 * option up in that sibling's table, so the reader exists and the other half
 * of the book's table can be transcribed.
 */
const DRACONIC_ANCESTORS: Readonly<Record<string, string>> = {
  Black: 'acid',
  Blue: 'lightning',
  Brass: 'fire',
  Bronze: 'lightning',
  Copper: 'acid',
  Gold: 'fire',
  Green: 'poison',
  Red: 'fire',
  Silver: 'cold',
  White: 'cold',
};

/**
 * SRD Breath Weapon: "This damage increases by 1d10 when you reach character
 * levels 5 (2d10), 11 (3d10), and 17 (4d10)."
 *
 * A column of twenty rows rather than four numbers, because that is what every
 * other table the vocabulary reads is: `diceCountByLevel` takes one entry per
 * level and reads the row the holder is on, and a species trait's level is the
 * character's own.
 */
const BREATH_WEAPON_DICE: readonly number[] = [
  1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4,
];

/**
 * One row of a lineage or legacy table: what the option knows now, and the two
 * spells it learns later.
 *
 * SRD prints the same four columns on the Elven Lineages, the Gnomish Lineage
 * and the Fiendish Legacies — an option, a level 1 benefit, a level 3 spell
 * and a level 5 spell — and the sentence above all three tables is word for
 * word the same.
 */
interface LineageRow {
  /** Cantrips the option knows from the moment it is chosen. */
  readonly cantrips: readonly string[];
  /** SRD: "When you reach character levels 3 and 5, you learn a higher-level spell." */
  readonly atThree?: string;
  readonly atFive?: string;
  /**
   * SRD Forest Gnome: "You also always have the Speak with Animals spell
   * prepared. You can cast it without a spell slot a number of times equal to
   * your Proficiency Bonus" — a spell prepared from level 1 whose free
   * castings the Proficiency Bonus counts, on the lineage's own pool.
   */
  readonly prepared?: string;
}

/** SRD: "Intelligence, Wisdom, or Charisma is your spellcasting ability." */
const LINEAGE_ABILITIES = ['int', 'wis', 'cha'] as const;

/**
 * The spell half of a lineage table, as grants gated on the option chosen.
 *
 * One grant per cell, because each is its own sentence: a cantrip is known
 * outright, and a levelled spell is "always prepared", castable once without a
 * slot and with a slot after that. The free casting's pool is named after the
 * spell, so the two levels of one legacy hold two pools and a character who
 * took the other legacy holds neither — an unchosen option's grant is never
 * compiled at all.
 */
const lineageSpells = (
  featureId: string,
  rows: Readonly<Record<string, LineageRow>>,
): readonly GatedFeatureGrant[] =>
  Object.entries(rows).flatMap(([option, row]) => [
    ...(row.cantrips.length === 0
      ? []
      : [
          {
            kind: 'spells' as const,
            fixed: row.cantrips,
            abilities: LINEAGE_ABILITIES,
            onlyIfChoice: option,
          },
        ]),
    ...(row.prepared === undefined
      ? []
      : [
          {
            kind: 'spells' as const,
            abilities: LINEAGE_ABILITIES,
            onlyIfChoice: option,
            freeCasting: {
              spell: row.prepared,
              pool: `${featureId}:${row.prepared}`,
              poolLabel: `free casting of ${row.prepared}`,
              // "You can cast it without a spell slot a number of times equal
              // to your Proficiency Bonus, and you regain all expended uses
              // when you finish a Long Rest."
              declares: { perProficiencyBonus: true as const, recovers: 'long-rest' as const },
              // "You can also use any spell slots you have to cast the spell."
              withSlots: true as const,
            },
          },
        ]),
    ...([
      [3, row.atThree],
      [5, row.atFive],
    ] as const).flatMap(([level, spell]) =>
      spell === undefined
        ? []
        : [
            {
              kind: 'spells' as const,
              abilities: LINEAGE_ABILITIES,
              onlyIfChoice: option,
              fromLevel: level,
              freeCasting: {
                spell,
                pool: `${featureId}:${spell}`,
                poolLabel: `free casting of ${spell}`,
                // "You can cast it once without a spell slot, and you regain
                // the ability to cast it in that way when you finish a Long
                // Rest."
                declares: { minimum: 1, recovers: 'long-rest' as const },
                // "You can also cast the spell using any spell slots you have
                // of the appropriate level."
                withSlots: true as const,
              },
            },
          ],
    ),
  ]);

/**
 * SRD Fiendish Legacies: the three legacies and the damage type each one's
 * level 1 benefit names.
 */
const FIENDISH_LEGACIES: Readonly<Record<string, string>> = {
  Abyssal: 'poison',
  Chthonic: 'necrotic',
  Infernal: 'fire',
};

/**
 * SRD Elven Lineages: the spells each lineage knows and learns.
 *
 * The rest of the level 1 column is two sentences the grants beside these say
 * - the Wood Elf's Speed and the Drow's further sixty feet of Darkvision.
 */
const ELVEN_SPELLS: Readonly<Record<string, LineageRow>> = {
  Drow: { cantrips: ['dancing-lights'], atThree: 'faerie-fire', atFive: 'darkness' },
  'High Elf': { cantrips: ['prestidigitation'], atThree: 'detect-magic', atFive: 'misty-step' },
  'Wood Elf': { cantrips: ['druidcraft'], atThree: 'longstrider', atFive: 'pass-without-trace' },
};

/**
 * SRD Gnomish Lineage: the cantrips each option knows.
 *
 * Neither option learns a spell at level 3 or 5 - the table the other two
 * species print is two paragraphs here - and the Forest Gnome's Speak with
 * Animals is not among these, because its uses are counted in Proficiency
 * Bonuses and no pool is sized that way.
 */
const GNOMISH_SPELLS: Readonly<Record<string, LineageRow>> = {
  'Forest Gnome': { cantrips: ['minor-illusion'], prepared: 'speak-with-animals' },
  'Rock Gnome': { cantrips: ['mending', 'prestidigitation'] },
};

/** The other three columns of the same table. */
const FIENDISH_SPELLS: Readonly<Record<string, LineageRow>> = {
  Abyssal: { cantrips: ['poison-spray'], atThree: 'ray-of-sickness', atFive: 'hold-person' },
  Chthonic: { cantrips: ['chill-touch'], atThree: 'false-life', atFive: 'ray-of-enfeeblement' },
  Infernal: { cantrips: ['fire-bolt'], atThree: 'hellish-rebuke', atFive: 'darkness' },
};

export const DRAGONBORN: SpeciesDefinition = {
  id: 'dragonborn',
  name: 'Dragonborn',
  creatureType: 'Humanoid',
  sizes: ['Medium'],
  speed: 30,
  features: [
    {
      id: 'dragonborn:draconic-ancestry',
      name: 'Draconic Ancestry',
      level: 1,
      automation: 'engine',
      note: 'The trait asks which dragon and publishes the table printed beside it, and both are executed: the choice is recorded on the character, and the Draconic Ancestors column - the damage type each dragon decides - is read off this feature by every trait written as "determined by your Draconic Ancestry", which is what `choiceFrom` names and what a gated grant reads. The Damage Resistance trait does exactly that. What the Breath Weapon still lacks is the Breath Weapon\'s own - its area, its save DC and its uses are recorded on its note - and the appearance the dragon also decides is fiction the DM narrates.',
      choice: { kind: 'option', choose: 1, from: Object.keys(DRACONIC_ANCESTORS) },
      optionMeans: meansDamage(DRACONIC_ANCESTORS),
    },
    {
      id: 'dragonborn:breath-weapon',
      name: 'Breath Weapon',
      level: 1,
      automation: 'engine',
      note: 'Executed. SRD: "When you take the Attack action on your turn, you can replace one of your attacks with an exhalation of magical energy in a 15-foot Cone or a 30-foot Line that is 5 feet wide (choose the shape each time). Each creature in that area must make a Dexterity saving throw (DC 8 plus your Constitution modifier and Proficiency Bonus). On a failed save, a creature takes 1d10 damage of the type determined by your Draconic Ancestry trait. On a successful save, a creature takes half as much damage." The price is one swing of an Attack action already taken, which is what `one-attack` spends; the shape is named at the use, out of the two the sentence prints; the DC is the trait’s own formula rather than a spell save DC a species has not got; the type is read off the Draconic Ancestors table through the same choice the Damage Resistance trait reads; and the dice are a column at the character’s own level — 1d10, then 2d10 at 5, 3d10 at 11 and 4d10 at 17. The uses are the pool they always were, sized by the Proficiency Bonus and refilled by a Long Rest.',
      grants: {
        kind: 'pool',
        key: 'dragonborn:breath-weapon',
        label: 'Breath Weapon',
        perProficiencyBonus: true,
        recovers: 'long-rest',
        // "damage of the type determined by your Draconic Ancestry trait" —
        // the same answer, off the same table, that the Damage Resistance
        // trait below reads. The type written on the effect is the placeholder
        // a stated choice always replaces.
        damageTypesFromChoice: true,
        choiceFrom: 'dragonborn:draconic-ancestry',
        options: [
          {
            id: 'breath-weapon',
            name: 'Breath Weapon',
            // "you can replace one of your attacks".
            action: 'one-attack',
            // "DC 8 plus your Constitution modifier and Proficiency Bonus."
            saveAbility: 'con',
            // "a 15-foot Cone or a 30-foot Line that is 5 feet wide (choose
            // the shape each time)."
            areas: [
              { kind: 'cone', length: 15, origin: 'self' },
              { kind: 'line', length: 30, width: 5, origin: 'self' },
            ],
            // "This damage increases by 1d10 when you reach character levels 5
            // (2d10), 11 (3d10), and 17 (4d10)" — a column read at the
            // character's own level, which is what a species trait's namespace
            // resolves to.
            diceCountByLevel: BREATH_WEAPON_DICE,
            effects: [
              {
                kind: 'save-damage',
                ability: 'dex',
                damage: { dice: '1d10' },
                damageType: 'fire',
                // "On a successful save, a creature takes half as much damage."
                onSuccess: 'half',
              },
            ],
          },
        ],
      },
    },
    {
      id: 'dragonborn:damage-resistance',
      name: 'Damage Resistance',
      level: 1,
      automation: 'engine',
      note: 'Applied whole: the Resistance is a standing grant measured against every hit, and the type is "determined by your Draconic Ancestry trait" - so the grant names that trait as where its choice was made and takes the damage type the Draconic Ancestors table prints beside the chosen dragon.',
      grants: {
        kind: 'standing',
        reach: 'self',
        // The types come from a choice made on another trait, through that
        // trait's own table. SRD prints no condition on this Resistance, so
        // nothing takes it away.
        effects: [{ kind: 'damage-resistance', damageTypes: [] }],
        damageTypesFromChoice: true,
        choiceFrom: 'dragonborn:draconic-ancestry',
      },
    },
    {
      id: 'dragonborn:darkvision',
      name: 'Darkvision',
      level: 1,
      automation: 'engine',
      note: 'The trait is one sentence and the sentence is applied: Darkvision and its 60 feet are a standing grant on the sheet, and canSee answers with them out to that range where nobody has declared a sight line and nobody has declared Total Cover. Every engine rule that asks whether one creature can see another goes through canSee, so this trait is read by the rule that wanted it rather than waiting on a declared line. What is left around it is the light: what the SRD glossary says Darkvision does to Dim Light and Darkness is not simulated, because the engine holds no light, which is why a declared line outranks the sense rather than the other way about.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'sense', sense: 'darkvision', feet: 60 }],
      },
    },
    {
      id: 'dragonborn:draconic-flight',
      name: 'Draconic Flight',
      level: 5,
      automation: 'engine',
      note: 'Executed. SRD: "Starting at character level 5, you can channel draconic magic to give yourself temporary flight. As a Bonus Action, you sprout spectral wings on your back that last for 10 minutes or until you retract the wings (no action required) or have the Incapacitated condition. During that time, you have a Fly Speed equal to your Speed. ... Once you use this trait, you can’t use it again until you finish a Long Rest." The Bonus Action, the ten minutes on the clock, the Fly Speed matched to the Speed while it runs and the ending on Incapacitated are the engine’s; `end_feature` retracts the wings.',
      grants: {
        kind: 'activated',
        action: 'bonus-action',
        pool: 'dragonborn:draconic-flight',
        poolLabel: 'Draconic Flight',
        recovers: 'long-rest',
        lastsSeconds: 600,
        endsOn: ['incapacitated'],
        whileActive: [{ kind: 'speed', change: 'match-walk', mode: 'fly' }],
      },
    },
  ],
};

export const DWARF: SpeciesDefinition = {
  id: 'dwarf',
  name: 'Dwarf',
  creatureType: 'Humanoid',
  sizes: ['Medium'],
  speed: 30,
  features: [
    {
      id: 'dwarf:darkvision',
      name: 'Darkvision',
      level: 1,
      automation: 'engine',
      note: 'The trait is one sentence and the sentence is applied: Darkvision and its 120 feet are a standing grant on the sheet, and canSee answers with them out to that range where nobody has declared a sight line and nobody has declared Total Cover. Every engine rule that asks whether one creature can see another goes through canSee, so this trait is read by the rule that wanted it rather than waiting on a declared line. What is left around it is the light: what the SRD glossary says Darkvision does to Dim Light and Darkness is not simulated, because the engine holds no light, which is why a declared line outranks the sense rather than the other way about.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'sense', sense: 'darkvision', feet: 120 }],
      },
    },
    {
      id: 'dwarf:dwarven-resilience',
      name: 'Dwarven Resilience',
      level: 1,
      automation: 'engine',
      note: 'Applied whole, in the two halves the sentence has. "You have Resistance to Poison damage" is a standing grant that every hit is measured against. "Advantage on saving throws you make to avoid or end the Poisoned condition" is a roll mode keyed to the condition the save is about — the axis a selector gained for this trait and its three siblings — so the dwarf rolls two dice against Contagion and one against everything else her Constitution answers for.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          { kind: 'damage-resistance', damageTypes: ['poison'] },
          {
            kind: 'roll-mode',
            modifier: {
              mode: 'advantage',
              selector: { roll: 'saving-throw', relation: 'roller', condition: 'poisoned' },
            },
          },
        ],
      },
    },
    {
      id: 'dwarf:dwarven-toughness',
      name: 'Dwarven Toughness',
      level: 1,
      automation: 'engine',
      note: 'The trait is one sentence and the sentence is applied: "Your Hit Point maximum increases by 1, and it increases by 1 again whenever you gain a level" is a hit-point-maximum grant read by planCharacter, so a level 1 Dwarf is one hit point above the class table and a level 5 Dwarf is five - and advanceCharacter hands over the level\'s own hit points and this one more, because it asks what the maximum has become rather than adding a number twice. The levels counted are the character\'s, which is what the sentence says: a Dwarf who multiclasses gains the hit point for every level of either class.',
      grants: { kind: 'hit-point-maximum', flat: 1, perLevel: 'character' },
    },
    {
      id: 'dwarf:stonecunning',
      name: 'Stonecunning',
      level: 1,
      automation: 'engine',
      note: 'Executed, with one fact handed over. SRD: "As a Bonus Action, you gain Tremorsense with a range of 60 feet for 10 minutes. You must be on a stone surface or touching a stone surface to use this Tremorsense. The stone can be natural or worked. You can use this Bonus Action a number of times equal to your Proficiency Bonus, and you regain all expended uses when you finish a Long Rest." The Bonus Action, the ten minutes on the clock in or out of a fight, the sense while it runs and the pool the Proficiency Bonus sizes are the engine’s. The stone surface is the table’s: the engine has no notion of what a creature stands on, so a DM who rules the Dwarf off stone ends the feature with `end_feature`.',
      grants: {
        kind: 'activated',
        action: 'bonus-action',
        pool: 'dwarf:stonecunning',
        poolLabel: 'Stonecunning',
        perProficiencyBonus: true,
        recovers: 'long-rest',
        lastsSeconds: 600,
        whileActive: [{ kind: 'sense', sense: 'tremorsense', feet: 60 }],
      },
    },
  ],
};

export const ELF: SpeciesDefinition = {
  id: 'elf',
  name: 'Elf',
  creatureType: 'Humanoid',
  sizes: ['Medium'],
  speed: 30,
  features: [
    {
      id: 'elf:darkvision',
      name: 'Darkvision',
      level: 1,
      automation: 'engine',
      note: 'The trait is one sentence and the sentence is applied: Darkvision and its 60 feet are a standing grant on the sheet, and canSee answers with them out to that range where nobody has declared a sight line and nobody has declared Total Cover. Every engine rule that asks whether one creature can see another goes through canSee, so this trait is read by the rule that wanted it rather than waiting on a declared line. What is left around it is the light: what the SRD glossary says Darkvision does to Dim Light and Darkness is not simulated, because the engine holds no light, which is why a declared line outranks the sense rather than the other way about.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'sense', sense: 'darkvision', feet: 60 }],
      },
    },
    {
      id: 'elf:elven-lineage',
      name: 'Elven Lineage',
      level: 1,
      automation: 'manual',
      note: 'Every lineage\'s benefits are applied but one sentence, which is why this is not marked as executed. The Wood Elf "Speed increases to 35 feet" is five feet of standing Speed and the Drow "range of your Darkvision increases to 120 feet" is a sense at its own range, each granted only to the lineage that chose it. The cantrip each lineage knows is granted outright, and the level 3 and level 5 spells arrive at those character levels, always prepared, free once before a Long Rest and castable with any slot the Elf has - all of them cast off the Intelligence, Wisdom or Charisma this trait asks the player to choose. What is left is the High Elf alone: "whenever you finish a Long Rest, you can replace that cantrip with a different cantrip from the Wizard spell list" is an option re-chosen on a rest, and nothing rewires a grant at the table.',
      choice: { kind: 'option', choose: 1, from: ['Drow', 'High Elf', 'Wood Elf'] },
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          // SRD: an Elf's Speed is 30 and the Wood Elf's "increases to 35
          // feet", so the grant is the difference, and only for the lineage
          // that took it, which is what `onlyIfChoice` says.
          onlyIfChoice: 'Wood Elf',
          effects: [{ kind: 'speed', feet: 5 }],
        },
        {
          kind: 'standing',
          reach: 'self',
          // "The range of your Darkvision increases to 120 feet" - the whole
          // range rather than the difference, because `sensesOf` takes the
          // furthest of what a creature holds and the Elf already has sixty.
          onlyIfChoice: 'Drow',
          effects: [{ kind: 'sense', sense: 'darkvision', feet: 120 }],
        },
        ...lineageSpells('elf:elven-lineage', ELVEN_SPELLS),
      ],
    },
    {
      id: 'elf:fey-ancestry',
      name: 'Fey Ancestry',
      level: 1,
      automation: 'engine',
      note: 'Applied: "Advantage on saving throws you make to avoid or end the Charmed condition" is a roll mode keyed to the condition, on the axis a selector gained for this trait and its three siblings. Both halves of "avoid or end" are the one grant — the save Charm Person forces and the save a turn boundary repeats against a charm already standing are the same sentence at two moments.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          {
            kind: 'roll-mode',
            modifier: {
              mode: 'advantage',
              selector: { roll: 'saving-throw', relation: 'roller', condition: 'charmed' },
            },
          },
        ],
      },
    },
    {
      id: 'elf:keen-senses',
      name: 'Keen Senses',
      level: 1,
      automation: 'engine',
      note: 'The chosen skill proficiency is applied to the sheet, and the choice is held to the three the trait offers.',
      choice: { kind: 'skill', choose: 1, from: ['insight', 'perception', 'survival'] },
    },
    {
      id: 'elf:trance',
      name: 'Trance',
      level: 1,
      automation: 'engine',
      note: 'The four hours are applied. SRD: "You can finish a Long Rest in 4 hours if you spend those hours in a trancelike meditation, during which you retain consciousness." A Long Rest was eight hours for everybody in this engine, one constant with no per-creature answer; it is a fact of the sheet now, so an Elf who has rested four hours may end one and nobody else may. The sixteen-hour wait before another Long Rest is untouched, because the SRD does not shorten it. What is handed to the table is the other sentence: "You don’t need to sleep, and magic can’t put you to sleep" — nothing models sleep at all here, so there is no state for the immunity to protect and no rule that reads it afterwards.',
      // SRD's four hours, in the seconds the clock counts.
      grants: { kind: 'long-rest-length', seconds: 4 * 60 * 60 },
    },
  ],
};

export const GNOME: SpeciesDefinition = {
  id: 'gnome',
  name: 'Gnome',
  creatureType: 'Humanoid',
  sizes: ['Small'],
  speed: 30,
  features: [
    {
      id: 'gnome:darkvision',
      name: 'Darkvision',
      level: 1,
      automation: 'engine',
      note: 'The trait is one sentence and the sentence is applied: Darkvision and its 60 feet are a standing grant on the sheet, and canSee answers with them out to that range where nobody has declared a sight line and nobody has declared Total Cover. Every engine rule that asks whether one creature can see another goes through canSee, so this trait is read by the rule that wanted it rather than waiting on a declared line. What is left around it is the light: what the SRD glossary says Darkvision does to Dim Light and Darkness is not simulated, because the engine holds no light, which is why a declared line outranks the sense rather than the other way about.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'sense', sense: 'darkvision', feet: 60 }],
      },
    },
    {
      id: 'gnome:gnomish-cunning',
      name: 'Gnomish Cunning',
      level: 1,
      automation: 'engine',
      note: 'Applied whole: three standing roll modes, one per ability the trait names, gathered at the save like any other Advantage and settled by the same presence rule - so a Gnome saving against a spell that imposes Disadvantage rolls one die rather than three.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          {
            kind: 'roll-mode',
            modifier: {
              mode: 'advantage',
              selector: { roll: 'saving-throw', relation: 'roller', ability: 'int' },
            },
          },
          {
            kind: 'roll-mode',
            modifier: {
              mode: 'advantage',
              selector: { roll: 'saving-throw', relation: 'roller', ability: 'wis' },
            },
          },
          {
            kind: 'roll-mode',
            modifier: {
              mode: 'advantage',
              selector: { roll: 'saving-throw', relation: 'roller', ability: 'cha' },
            },
          },
        ],
      },
    },
    {
      id: 'gnome:gnomish-lineage',
      name: 'Gnomish Lineage',
      level: 1,
      automation: 'manual',
      note: 'The cantrips each option knows are applied and the rest is the DM, which is why this is not marked as executed. A Forest Gnome knows Minor Illusion and a Rock Gnome knows Mending and Prestidigitation, granted only to the option chosen and cast off the Intelligence, Wisdom or Charisma this trait asks for. The Forest Gnome\'s Speak with Animals is always prepared and cast without a slot a number of times equal to your Proficiency Bonus, which is a pool the lineage declares and `cast_spell` spends — as far as the spell goes, and it has no definition yet. One sentence is left: the Rock Gnome\'s clockwork device is an object with its own Armour Class, hit point and Bonus Action that nothing in the engine creates.',
      choice: { kind: 'option', choose: 1, from: ['Forest Gnome', 'Rock Gnome'] },
      grants: lineageSpells('gnome:gnomish-lineage', GNOMISH_SPELLS),
    },
  ],
};

export const GOLIATH: SpeciesDefinition = {
  id: 'goliath',
  name: 'Goliath',
  creatureType: 'Humanoid',
  sizes: ['Medium'],
  speed: 35,
  features: [
    {
      id: 'goliath:giant-ancestry',
      name: 'Giant Ancestry',
      level: 1,
      automation: 'engine',
      note: 'Executed whole: the boon the Goliath chose is the one grant that arrives, and each of the six is now a mechanism the engine has. SRD: "Choose one of the following benefits; you can use it a number of times equal to your Proficiency Bonus, and you regain all expended uses when you finish a Long Rest." The pool is that sentence and is declared once for all six. Cloud\'s Jaunt — "As a Bonus Action, you magically teleport up to 30 feet to an unoccupied space you can see" — is a Bonus Action option on that pool carrying a teleport, with the space named at the use; the engine measures the thirty feet and refuses an occupied one, and what the scene answers is whether the Goliath can see where they are going, because sight is declared between creatures rather than ray-cast — a destination measured from a landmark is reported unchecked. Fire\'s Burn — "When you hit a target with an attack roll and deal damage to it, you can also deal 1d10 Fire damage to that target" — is a rider the swing asks for whose dice ride on the blow itself, so a Critical Hit doubles them and the target\'s Fire Resistance halves them with the rest. Frost\'s Chill is that sentence in Cold with ten feet of the target\'s Speed taken away until the start of the Goliath\'s next turn. Hill\'s Tumble — "When you hit a Large or smaller creature with an attack roll and deal damage to it, you can give that target the Prone condition" — is a rider whose size clause is asked at the swing, and what the scene answers is how big the target is: a creature nobody has measured is knocked down and the assumption is handed back. Stone\'s Endurance — "When you take damage, you can take a Reaction to roll 1d12. Add your Constitution modifier to the number rolled and reduce the damage by that total" — answers the damage window Uncanny Dodge answers, before the blow lands. Storm\'s Thunder — "When you take damage from a creature within 60 feet of you, you can take a Reaction to deal 1d8 Thunder damage to that creature" — answers the window Hellish Rebuke is cast into, through the damage funnel, so the attacker\'s Resistance and whatever watches for a creature dropping both apply; what the scene answers is where the two are standing.',
      grants: [
        // "you can use it a number of times equal to your Proficiency Bonus,
        // and you regain all expended uses when you finish a Long Rest" — one
        // pool for whichever boon was chosen, declared ungated because the
        // sentence is printed once above all six.
        {
          kind: 'pool',
          key: 'goliath:giant-ancestry',
          label: 'Giant Ancestry',
          perProficiencyBonus: true,
          recovers: 'long-rest',
        },
        // "**Cloud's Jaunt.** As a Bonus Action, you magically teleport up to
        // 30 feet to an unoccupied space you can see."
        //
        // A form the pool above takes rather than a pool of its own, which is
        // the Channel Divinity shape the owner ruled for: one pool, a menu,
        // and the trait's own choice picks which entry of it this Goliath has.
        {
          onlyIfChoice: "Cloud's Jaunt",
          kind: 'pool-options',
          feature: 'goliath:giant-ancestry',
          options: [
            {
              id: 'clouds-jaunt',
              name: "Cloud's Jaunt",
              action: 'bonus-action',
              // Aimed at nobody, so it lands on the Goliath themselves — the
              // one target an option with no reach at all can have.
              effects: [{ kind: 'teleport', feet: 30, requiresSight: true }],
            },
          ],
        },
        // "**Fire's Burn.** When you hit a target with an attack roll and deal
        // damage to it, you can also deal 1d10 Fire damage to that target."
        //
        // The dice are `extraDamage` rather than an effect, because the effect
        // list runs after the blow has landed and an attack holds one damage
        // roll at a time; this is a component of the blow.
        {
          onlyIfChoice: "Fire's Burn",
          kind: 'on-hit',
          pool: 'goliath:giant-ancestry',
          costs: 1,
          options: [
            {
              id: 'fires-burn',
              name: "Fire's Burn",
              effects: [],
              extraDamage: { dice: '1d10', damageType: 'fire' },
            },
          ],
        },
        // "**Frost's Chill.** When you hit a target with an attack roll and
        // deal damage to it, you can also deal 1d6 Cold damage to that target
        // and reduce its Speed by 10 feet until the start of your next turn."
        {
          onlyIfChoice: "Frost's Chill",
          kind: 'on-hit',
          pool: 'goliath:giant-ancestry',
          costs: 1,
          options: [
            {
              id: 'frosts-chill',
              name: "Frost's Chill",
              // "reduce its Speed by 10 feet" — signed feet on the operation
              // that adds, which is how a Speed taken away is written.
              effects: [{ kind: 'speed', change: 'add', feet: -10 }],
              // "until the start of **your** next turn": the Goliath's, which
              // is what an omitted anchor already means.
              lasts: 'start-of-next-turn',
              extraDamage: { dice: '1d6', damageType: 'cold' },
            },
          ],
        },
        // "**Hill's Tumble.** When you hit a Large or smaller creature with an
        // attack roll and deal damage to it, you can give that target the
        // Prone condition."
        {
          onlyIfChoice: "Hill's Tumble",
          kind: 'on-hit',
          pool: 'goliath:giant-ancestry',
          costs: 1,
          // "a **Large or smaller** creature", asked at the swing so an Ogre
          // refuses the boon before the Goliath has spent anything.
          targetNoLargerThan: 'large',
          options: [
            {
              id: 'hills-tumble',
              name: "Hill's Tumble",
              // No saving throw: the sentence gives the condition outright.
              // Prone needs no span, because the creature stands up.
              effects: [{ kind: 'condition', condition: { name: 'prone' } }],
            },
          ],
        },
        // "**Stone's Endurance.** When you take damage, you can take a
        // Reaction to roll 1d12. Add your Constitution modifier to the number
        // rolled and reduce the damage by that total."
        //
        // The window Uncanny Dodge answers — damage rolled and not yet applied
        // — with dice where that one halves. "When you take damage" and not
        // "when an attack hits you", so there is no `fromAttackOnly` and a
        // Fireball is answered too.
        {
          onlyIfChoice: "Stone's Endurance",
          kind: 'reaction',
          costsReaction: true,
          reach: { kind: 'self' },
          pool: 'goliath:giant-ancestry',
          does: [{ kind: 'reduce-damage', amount: { dice: '1d12', plus: ['con'] } }],
        },
        // "**Storm's Thunder.** When you take damage from a creature within 60
        // feet of you, you can take a Reaction to deal 1d8 Thunder damage to
        // that creature."
        //
        // The settled window Retaliation and Hellish Rebuke both answer, with
        // dice thrown back where Retaliation swings.
        {
          onlyIfChoice: "Storm's Thunder",
          kind: 'reaction',
          costsReaction: true,
          reach: { kind: 'self' },
          pool: 'goliath:giant-ancestry',
          does: [{ kind: 'damage-back', dice: '1d8', damageType: 'thunder', within: 60 }],
        },
      ],
      choice: {
        kind: 'option',
        choose: 1,
        from: [
          "Cloud's Jaunt",
          "Fire's Burn",
          "Frost's Chill",
          "Hill's Tumble",
          "Stone's Endurance",
          "Storm's Thunder",
        ],
      },
    },
    {
      id: 'goliath:large-form',
      name: 'Large Form',
      level: 5,
      automation: 'engine',
      note: 'Executed, with one fact handed over. SRD: "Starting at character level 5, you can change your size to Large as a Bonus Action if you’re in a big enough space. This transformation lasts for 10 minutes or until you end it (no action required). For that duration, you have Advantage on Strength checks, and your Speed increases by 10 feet. Once you use this trait, you can’t use it again until you finish a Long Rest." The Bonus Action, the ten minutes on the clock, the size on the map while it runs, the Advantage on Strength checks and the ten feet of Speed are the engine’s, and `end_feature` is the ending that costs nothing. Whether the space is big enough is the table’s.',
      grants: {
        kind: 'activated',
        action: 'bonus-action',
        pool: 'goliath:large-form',
        poolLabel: 'Large Form',
        recovers: 'long-rest',
        lastsSeconds: 600,
        size: 'large',
        whileActive: [
          { kind: 'speed', feet: 10 },
          {
            kind: 'roll-mode',
            modifier: {
              mode: 'advantage',
              selector: { roll: 'ability-check', relation: 'roller', ability: 'str' },
            },
          },
        ],
      },
    },
    {
      id: 'goliath:powerful-build',
      name: 'Powerful Build',
      level: 1,
      automation: 'engine',
      note: 'Both printed benefits are applied. "Advantage on any ability check you make to end the Grappled condition" names a condition, which is the axis a selector gained for Brave and its siblings and which was legal on a saving throw alone: no ability check said what it was about. Two of them do now - resolveEffectCheck and escapeGrapple, the two doors out of an effect, both deriving the condition from the very timer they are settling - so the grant picks out the escape and no other Strength or Dexterity check the Goliath makes, on either of the two abilities the book offers. The other half is the Carrying Capacity table, which the objects batch built: a carrying-capacity grant moves which row of it this creature reads, so a Medium Goliath carries and drags the Large figures, and nothing else about its size moves - it occupies the same space, is grappled by the same sizes and squeezes through the same gaps, because the sentence is about that table and says so.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          {
            kind: 'roll-mode',
            modifier: {
              mode: 'advantage',
              selector: { roll: 'ability-check', relation: 'roller', condition: 'grappled' },
            },
          },
          { kind: 'carrying-capacity', sizesLarger: 1 },
        ],
      },
    },
  ],
};

export const HALFLING: SpeciesDefinition = {
  id: 'halfling',
  name: 'Halfling',
  creatureType: 'Humanoid',
  sizes: ['Small'],
  speed: 30,
  features: [
    {
      id: 'halfling:brave',
      name: 'Brave',
      level: 1,
      automation: 'engine',
      note: 'Applied: "Advantage on saving throws you make to avoid or end the Frightened condition" is a roll mode keyed to the condition, on the axis a selector gained for this trait and its three siblings. It reaches the save that would frighten the halfling and no other Wisdom save she makes, which is the whole of the narrowing the trait needed.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          {
            kind: 'roll-mode',
            modifier: {
              mode: 'advantage',
              selector: { roll: 'saving-throw', relation: 'roller', condition: 'frightened' },
            },
          },
        ],
      },
    },
    {
      id: 'halfling:halfling-nimbleness',
      name: 'Halfling Nimbleness',
      level: 1,
      automation: 'engine',
      note: 'Applied, and the rule it bends had to be wired first: "you can move through the space of any creature that is a size larger than you" is an exception to the glossary\'s two sizes, and until this landed nothing asked canPassThrough at all - choosePoint tested the destination, so anybody walked through anybody as long as they did not stop there. resolveMove now reads the spaces a move states in its route, one by one, and a passage grant lowers the two sizes to one for its holder alone: a Halfling walks through a Human and is still refused through another Halfling, because the sentence names the larger side and nothing lets anybody through a creature of their own size. "But you can\'t stop in the same space" needs no grant - occupied has refused every creature a stop in an occupied space since positioning landed, which is SRD\'s "You can\'t willingly end a move in a space occupied by another creature."',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'passage', sizesLarger: 1 }],
      },
    },
    {
      id: 'halfling:luck',
      name: 'Luck',
      level: 1,
      automation: 'engine',
      note: 'Applied. "When you roll a 1 on the d20 of a D20 Test, you can reroll the die, and you must use the new roll" is a rule read after the die lands, so it is neither a roll mode nor the Reaction reroll Indomitable takes: it costs nothing, is offered by nobody and fires on the face. The grant names the face, sheetAsItStands derives it onto the sheet on every read, and the two rollers that throw a d20 for a test read it there - so it reaches every ability check, every saving throw, every attack roll, Initiative and a death saving throw without a single roll site having to remember it. Exactly one reroll: a 1 on the new die stands, because "the new roll" is the roll the test made. Under Advantage or Disadvantage it is the die the mode picked out that is thrown again and the other stands. Both faces are in the log - the first on roll-recorded supersedes, the second as the roll itself - and it never touches a face a table read out, because a stated die takes the other path.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'reroll-test-die', on: 1 }],
      },
    },
    {
      id: 'halfling:naturally-stealthy',
      name: 'Naturally Stealthy',
      level: 1,
      automation: 'engine',
      note: 'Executed. SRD: "You can take the Hide action even when you are obscured only by a creature that is at least one size larger than you." The concealment `takeHide` asks for — Three-Quarters Cover, Total Cover or Heavy Obscurement — is widened for this trait’s holder to a creature at least one size larger standing within five feet; the Hide names that creature and hands the table the one fact it did not check, which watcher the creature stands between the hider and.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'hides-behind-larger-creature' }],
      },
    },
  ],
};

export const HUMAN: SpeciesDefinition = {
  id: 'human',
  name: 'Human',
  creatureType: 'Humanoid',
  sizes: ['Medium', 'Small'],
  speed: 30,
  features: [
    {
      id: 'human:resourceful',
      name: 'Resourceful',
      level: 1,
      automation: 'manual',
      note: 'Most of it is applied, which is why this is not marked as executed. The Heroic Inspiration is a Reaction in the window Indomitable already answers: SRD "You gain Heroic Inspiration whenever you finish a Long Rest", and the glossary, "you can expend it to reroll any die immediately after rolling it, and you must use the new roll." A pool of one that a Long Rest refills, spent from the test-rolled window on a failed ability check or saving throw, costing no Reaction. Not offered: the reroll of a roll that succeeded, so that an ordinary check stays a single call (the one case where a made roll’s total still matters, a Stealth check’s total being the DC to find the hider, is the table’s), and the reroll of an attack roll or a damage die, which land in no window a reroll can answer in. Those three are the clause the ledger files, not the table’s.',
      grants: {
        kind: 'reaction',
        costsReaction: false,
        reach: { kind: 'self' },
        pool: 'human:heroic-inspiration',
        poolLabel: 'Heroic Inspiration',
        declares: { recovers: 'long-rest' },
        does: [{ kind: 'reroll', tests: ['ability-check', 'saving-throw'] }],
      },
    },
    {
      id: 'human:skillful',
      name: 'Skillful',
      level: 1,
      automation: 'engine',
      note: 'The chosen skill proficiency is applied to the sheet.',
      choice: { kind: 'skill', choose: 1 },
    },
    {
      id: 'human:versatile',
      name: 'Versatile',
      level: 1,
      automation: 'engine',
      note: 'The chosen Origin feat is validated, and applied as far as that feat is executed - see the feat own note, which says what a DM still has to do.',
      choice: { kind: 'feat', choose: 1, category: 'origin' },
    },
  ],
};

export const ORC: SpeciesDefinition = {
  id: 'orc',
  name: 'Orc',
  creatureType: 'Humanoid',
  sizes: ['Medium'],
  speed: 30,
  features: [
    {
      id: 'orc:adrenaline-rush',
      name: 'Adrenaline Rush',
      level: 1,
      automation: 'engine',
      note: 'Executed whole. SRD: "You can take the Dash action as a Bonus Action. When you do so, you gain a number of Temporary Hit Points equal to your Proficiency Bonus. You can use this trait a number of times equal to your Proficiency Bonus, and you regain all expended uses of it when you finish a Long Rest." The allowance is an action rule the trait holds, derived on every read like any other standing grant; `takeDash` charges the Bonus Action when the Orc asks for that price, spends one of the trait’s uses and grants the Temporary Hit Points, and refuses the price with the uses spent and nothing charged. The uses are a pool the Proficiency Bonus sizes, grown by advancement and refilled by a Long Rest.',
      grants: [
        {
          kind: 'pool',
          key: 'orc:adrenaline-rush',
          label: 'Adrenaline Rush',
          perProficiencyBonus: true,
          recovers: 'long-rest',
        },
        {
          kind: 'standing',
          reach: 'self',
          effects: [
            {
              kind: 'action-rule',
              rule: { kind: 'allows', action: 'dash', from: 'bonus-action' },
              spends: 'orc:adrenaline-rush',
              temporaryHitPoints: 'proficiency-bonus',
            },
          ],
        },
      ],
    },
    {
      id: 'orc:darkvision',
      name: 'Darkvision',
      level: 1,
      automation: 'engine',
      note: 'The trait is one sentence and the sentence is applied: Darkvision and its 120 feet are a standing grant on the sheet, and canSee answers with them out to that range where nobody has declared a sight line and nobody has declared Total Cover. Every engine rule that asks whether one creature can see another goes through canSee, so this trait is read by the rule that wanted it rather than waiting on a declared line. What is left around it is the light: what the SRD glossary says Darkvision does to Dim Light and Darkness is not simulated, because the engine holds no light, which is why a declared line outranks the sense rather than the other way about.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'sense', sense: 'darkvision', feet: 120 }],
      },
    },
    {
      id: 'orc:relentless-endurance',
      name: 'Relentless Endurance',
      level: 1,
      automation: 'engine',
      note: 'Applied. Dropping to 1 Hit Point instead of 0 is a decision taken at the moment damage lands, and it is taken there: damageCreature runs the rules once to see what the blow would do, and where the answer is a drop to 0 that is not a death it pins a floor onto the damage-taken event and spends the use. The floor is on the event rather than in the command because the fold recomputes the blow from the event - a decision the command kept to itself would be undone the first time the log was replayed - so a replay reads a number somebody already decided and opens no catalogue. "But not killed outright" needs no field: Massive Damage and a monster death at 0 are both settled before the floor is read, so the trait cannot fire on either. The once-a-day limit is a tally keyed to this trait with long-rest on it, counted off the very event that carries the floor and zeroed by the rest, and the reader refuses a second use while the count stands - a count rather than a pool because nothing declares a tally and a feature carries one grant, which this trait has already spent on the rule itself. The price rides on the claim rather than beside it, so the two cannot come apart in a log and a blow is never asked whose turn it is.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          {
            kind: 'hit-point-floor',
            floor: 1,
            key: 'orc:relentless-endurance',
            recovers: 'long-rest',
          },
        ],
      },
    },
  ],
};

export const TIEFLING: SpeciesDefinition = {
  id: 'tiefling',
  name: 'Tiefling',
  creatureType: 'Humanoid',
  sizes: ['Medium', 'Small'],
  speed: 30,
  features: [
    {
      id: 'tiefling:darkvision',
      name: 'Darkvision',
      level: 1,
      automation: 'engine',
      note: 'The trait is one sentence and the sentence is applied: Darkvision and its 60 feet are a standing grant on the sheet, and canSee answers with them out to that range where nobody has declared a sight line and nobody has declared Total Cover. Every engine rule that asks whether one creature can see another goes through canSee, so this trait is read by the rule that wanted it rather than waiting on a declared line. What is left around it is the light: what the SRD glossary says Darkvision does to Dim Light and Darkness is not simulated, because the engine holds no light, which is why a declared line outranks the sense rather than the other way about.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'sense', sense: 'darkvision', feet: 60 }],
      },
    },
    {
      id: 'tiefling:fiendish-legacy',
      name: 'Fiendish Legacy',
      level: 1,
      automation: 'engine',
      note: 'The whole table is applied. The choice is a legacy rather than a damage type, and the legacy names one - Poison, Necrotic or Fire - so the trait declares what each of its options means and the Resistance reads the type out of that table. The other three columns are spells: the cantrip the legacy knows is granted outright, and the level 3 and level 5 spells arrive at those character levels, always prepared, castable once without a slot before a Long Rest gives the casting back, and castable with any slot the holder has - which a Fighter has none of and a Wizard has. Each of them is cast off the Intelligence, Wisdom or Charisma this trait asks the player to choose.',
      choice: { kind: 'option', choose: 1, from: Object.keys(FIENDISH_LEGACIES) },
      optionMeans: meansDamage(FIENDISH_LEGACIES),
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          // The choice is on this feature, so the grant names no other — what
          // it needed was the table, which turns a legacy into a damage type.
          effects: [{ kind: 'damage-resistance', damageTypes: [] }],
          damageTypesFromChoice: true,
        },
        ...lineageSpells('tiefling:fiendish-legacy', FIENDISH_SPELLS),
      ],
    },
    {
      id: 'tiefling:otherworldly-presence',
      name: 'Otherworldly Presence',
      level: 1,
      automation: 'engine',
      note: 'The trait is two sentences and both are applied: the Thaumaturgy cantrip is granted to a holder who may cast nothing else at all, and "when you cast it with this trait, the spell uses the same spellcasting ability you use for your Fiendish Legacy trait" is what naming that trait says - the ability is one question, asked on the legacy and read here rather than asked twice.',
      grants: {
        kind: 'spells',
        fixed: ['thaumaturgy'],
        // Whose answer, rather than a second question: the legacy asked it.
        choiceFrom: 'tiefling:fiendish-legacy',
      },
    },
  ],
};

export const ACOLYTE: BackgroundDefinition = {
  id: 'acolyte',
  name: 'Acolyte',
  abilities: ['int', 'wis', 'cha'],
  feat: 'Magic Initiate (Cleric)',
  skillProficiencies: ['insight', 'religion'],
  toolProficiency: "Calligrapher's Supplies",
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'calligraphers-supplies', quantity: 1 },
        { id: 'book', quantity: 1, detail: 'prayers' },
        { id: 'holy-symbol', quantity: 1 },
        { id: 'parchment', quantity: 10, detail: 'sheets' },
        { id: 'robe', quantity: 1 },
      ],
      goldPieces: 8,
    },
    { option: 'B', items: [], goldPieces: 50 },
  ],
  features: [
    {
      id: 'acolyte:magic-initiate-cleric',
      name: 'Magic Initiate (Cleric)',
      level: 1,
      automation: 'engine',
      note: 'The chosen spells reach usable state: castable through resolveSpell on the feat own spellcasting ability, and the level 1 spell free daily casting is a long-rest pool. The list is pinned to the Cleric one the background names, and a spell chosen off another list is refused. What is missing is a definition for each spell - the engine executes only the spells it has been taught.',
      grantsFeat: { featId: 'magic-initiate', spellList: 'cleric' },
    },
  ],
};

export const CRIMINAL: BackgroundDefinition = {
  id: 'criminal',
  name: 'Criminal',
  abilities: ['dex', 'con', 'int'],
  feat: 'Alert',
  skillProficiencies: ['sleight-of-hand', 'stealth'],
  toolProficiency: "Thieves' Tools",
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'dagger', quantity: 2 },
        { id: 'thieves-tools', quantity: 1 },
        { id: 'crowbar', quantity: 1 },
        { id: 'pouch', quantity: 2 },
        { id: 'clothes-travelers', quantity: 1 },
      ],
      goldPieces: 16,
    },
    { option: 'B', items: [], goldPieces: 50 },
  ],
  features: [
    {
      id: 'criminal:alert',
      name: 'Alert',
      level: 1,
      automation: 'engine',
      note: 'The granted feat is validated, and applied as far as that feat is executed: the Initiative Proficiency comes back from creation as a named bonus rollInitiative takes like any other. The Initiative swap does not - see the feat own note, which says what a DM still has to do.',
      grantsFeat: { featId: 'alert' },
    },
  ],
};

export const SAGE: BackgroundDefinition = {
  id: 'sage',
  name: 'Sage',
  abilities: ['con', 'int', 'wis'],
  feat: 'Magic Initiate (Wizard)',
  skillProficiencies: ['arcana', 'history'],
  toolProficiency: "Calligrapher's Supplies",
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'quarterstaff', quantity: 1 },
        { id: 'calligraphers-supplies', quantity: 1 },
        { id: 'book', quantity: 1, detail: 'history' },
        { id: 'parchment', quantity: 8, detail: 'sheets' },
        { id: 'robe', quantity: 1 },
      ],
      goldPieces: 8,
    },
    { option: 'B', items: [], goldPieces: 50 },
  ],
  features: [
    {
      id: 'sage:magic-initiate-wizard',
      name: 'Magic Initiate (Wizard)',
      level: 1,
      automation: 'engine',
      note: 'The chosen spells reach usable state: castable through resolveSpell on the feat own spellcasting ability, and the level 1 spell free daily casting is a long-rest pool. What is missing is a definition for each spell - the engine executes only the spells it has been taught.',
      grantsFeat: { featId: 'magic-initiate', spellList: 'wizard' },
    },
  ],
};

export const SOLDIER: BackgroundDefinition = {
  id: 'soldier',
  name: 'Soldier',
  abilities: ['str', 'dex', 'con'],
  feat: 'Savage Attacker',
  skillProficiencies: ['athletics', 'intimidation'],
  // SRD: "Choose one kind of Gaming Set." The kind is the player's and the
  // sheet holds one string, the way the Bard's "Musical Instrument" does.
  toolProficiency: 'Gaming Set',
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'spear', quantity: 1 },
        { id: 'shortbow', quantity: 1 },
        { id: 'arrows', quantity: 20 },
        { id: 'gaming-set', quantity: 1, detail: 'the kind chosen above' },
        { id: 'healers-kit', quantity: 1 },
        { id: 'quiver', quantity: 1 },
        { id: 'clothes-travelers', quantity: 1 },
      ],
      goldPieces: 14,
    },
    { option: 'B', items: [], goldPieces: 50 },
  ],
  features: [
    {
      id: 'soldier:savage-attacker',
      name: 'Savage Attacker',
      level: 1,
      automation: 'engine',
      note: 'Applied, and for free: the background names the Origin feat, creation checks that it is the right one and grants it, and the feat own standing grant is what executes. Rolling the weapon damage dice twice once per turn and using either roll is the feat sentence rather than the background, so this feature holds no second copy of it - see the feat own note for what the rule does and what it reaches.',
      grantsFeat: { featId: 'savage-attacker' },
    },
  ],
};

/** Every species the SRD publishes, in the order the book prints them. */
export const SPECIES: readonly SpeciesDefinition[] = [
  DRAGONBORN,
  DWARF,
  ELF,
  GNOME,
  GOLIATH,
  HALFLING,
  HUMAN,
  ORC,
  TIEFLING,
];

/** Every background the SRD publishes, in the order the book prints them. */
export const BACKGROUNDS: readonly BackgroundDefinition[] = [ACOLYTE, CRIMINAL, SAGE, SOLDIER];

/** SRD "Origin Feats". The four the SRD publishes, no more. */
export const ORIGIN_FEATS: readonly FeatDefinition[] = [
  {
    id: 'alert',
    name: 'Alert',
    category: 'origin',
    requires: { kind: 'none' },
    repeatable: false,
    // SRD prints two benefits under Alert and both are declared here, because
    // the feat prints two sentences and a definition carries one grant.
    // Creation reads the first into initiativeBonuses under this feat name,
    // where rollInitiative takes it like any other named bonus; the second is
    // the permission swapInitiativeBetween asks for before it will write a
    // swap at all.
    grants: { kind: 'initiative', proficiency: true, swap: true },
    note: 'Both printed benefits are applied. Initiative Proficiency adds the Proficiency Bonus to the roll. Initiative Swap is the permission the swap command asks for: the owner ruled on 2026-09-20 that the choice is the feat-holder’s and has a window, so the swap is refused outside the first turn of the fight, refused for a swapper without this grant, and refused for an ally whose consent the table has not stated - which is asked for rather than refused, because a fact nobody has said is missing rather than wrong.',
  },
  {
    id: 'magic-initiate',
    name: 'Magic Initiate',
    category: 'origin',
    requires: { kind: 'magic-initiate', lists: ['cleric', 'druid', 'wizard'] },
    repeatable: true,
    note: 'The chosen spells are castable, on this feat own spellcasting ability, and the level 1 spell free daily casting is a long-rest pool the engine spends. Spell change on levelling is not modelled, and a chosen spell still needs an executable definition before it does anything.',
  },
  {
    id: 'savage-attacker',
    name: 'Savage Attacker',
    category: 'origin',
    requires: { kind: 'none' },
    repeatable: false,
    grants: {
      kind: 'standing',
      reach: 'self',
      effects: [{ kind: 'attack-roll-rule', rule: { kind: 'roll-twice-keep-either' }, oncePerTurn: true }],
    },
    note: 'Applied. "Roll the weapon damage dice twice and use either roll" is a rule about the roll rather than about a die in it, which is the scope rollUnder in the dice layer answers and the one Great Weapon Fighting beside it does not: the second throw is made, the lower total is dropped rather than discarded, and both throws reach the log in the one damage roll they are two halves of. It reaches the weapon own dice and nothing else, so a Sneak Attack riding on the same hit is thrown once; on a Critical Hit it is the doubled set that is thrown twice, because that is what the weapon damage dice are by then. No narrowing is declared, because the sentence has none - it says "a weapon", not which. "Once per turn" is the combat ledger own mark, so a second hit on the same turn rolls once; out of combat there is no turn to be once in. "Use either" is taken as the higher of the two, which is the only choice a player has a reason to make and is stated rather than asked.',
  },
  {
    id: 'skilled',
    name: 'Skilled',
    category: 'origin',
    requires: { kind: 'proficiencies', choose: 3 },
    repeatable: true,
    note: 'The three chosen proficiencies *are* applied to the sheet; nothing else about the feat needs applying.',
  },
];

/**
 * SRD "General Feats" — the one of the two whose whole text the engine says.
 *
 * The other is Grappler, and it is **left out** for rule 1 of `items.ts`
 * applied to a feat: its bracket prints "Strength or Dexterity 13+", which is
 * a prerequisite on a *score* and `FeatDefinition` gates only on a level, and
 * three of its four benefits are Unarmed Strike and Grapple rules the attack
 * layer has no notion of. A record carrying one point and four notes would be
 * a feat that looks transcribed.
 */
export const GENERAL_FEATS: readonly FeatDefinition[] = [
  {
    id: 'ability-score-improvement',
    name: 'Ability Score Improvement',
    category: 'general',
    // SRD: "Increase one ability score of your choice by 2, or increase two
    // ability scores of your choice by 1." Both branches of one sentence,
    // each as the points it puts into that many distinct scores.
    requires: { kind: 'ability-score', spreads: [[2], [1, 1]] },
    // SRD: "_General Feat (Prerequisite: Level 4+)_".
    minimumLevel: 4,
    // SRD: "You can take this feat more than once."
    repeatable: true,
    // No grant: "This feat can't increase an ability score above 20" is the
    // ceiling every score already has, so there is nothing for the feat to
    // lift and a grant saying 20 would be refused for saying nothing.
    note: 'The whole of the feat is applied: the points land on the scores the player named, and the 20 they cannot pass is the maximum every score of every character already keeps.',
  },
];

/**
 * SRD "Epic Boon Feats" — the seven the SRD publishes.
 *
 * **Seven, and the count is worth saying**, because the note this brief
 * inherited said nine: `feats.md` prints Combat Prowess, Dimensional Travel,
 * Fate, Irresistible Offense, Spell Recall, the Night Spirit and Truesight,
 * and the wider game's list is longer than the SRD's.
 *
 * Every one of them opens with the same mechanical sentence — "Increase one
 * ability score of your choice by 1, to a maximum of 30" — and that is the
 * half transcribed here: the question in `requires`, the lifted ceiling in
 * `grants`. Two of the seven narrow which scores and say so.
 *
 * **The second benefit is a note on every one of them**, and each note says
 * which mechanic is missing rather than "not automated". Truesight's is the
 * closest to expressible and still is not: `sense` is a standing grant the
 * vocabulary has, and a feat carries **one** grant, which this feat has
 * already spent on the ceiling. A *feature* carries as many as it needs now;
 * `FeatDefinition.grants` is still one, because no SRD feat below level 19
 * wants a second and a feat goes through none of the passes a feature does.
 */
export const EPIC_BOON_FEATS: readonly FeatDefinition[] = [
  {
    id: 'boon-of-combat-prowess',
    name: 'Boon of Combat Prowess',
    category: 'epic-boon',
    requires: { kind: 'ability-score', spreads: [[1]] },
    minimumLevel: 19,
    repeatable: false,
    grants: { kind: 'ability-score-increase', maximum: 30 },
    note: 'Peerless Aim is not applied: "When you miss with an attack roll, you can hit instead" replaces the outcome of a roll after it is made, which is the substitution the D20 pipeline has for damage dice and not for a D20 Test, and it is spent out of a once-per-turn allowance no feat can declare.',
  },
  {
    id: 'boon-of-dimensional-travel',
    name: 'Boon of Dimensional Travel',
    category: 'epic-boon',
    requires: { kind: 'ability-score', spreads: [[1]] },
    minimumLevel: 19,
    repeatable: false,
    grants: { kind: 'ability-score-increase', maximum: 30 },
    note: 'Blink Steps is not applied: teleporting up to 30 feet immediately after the Attack or Magic action is a move a feature hands its holder outside the turn’s allowance, and nothing in the grant vocabulary offers one.',
  },
  {
    id: 'boon-of-fate',
    name: 'Boon of Fate',
    category: 'epic-boon',
    requires: { kind: 'ability-score', spreads: [[1]] },
    minimumLevel: 19,
    repeatable: false,
    grants: { kind: 'ability-score-increase', maximum: 30 },
    note: 'Improve Fate is not applied: rolling 2d4 and applying it as a bonus or a penalty to somebody else’s finished D20 Test is a modifier put on another creature after the roll, and the recovery it is spent against ("until you roll Initiative or finish a Short or Long Rest") is a pool a feat cannot declare.',
  },
  {
    id: 'boon-of-irresistible-offense',
    name: 'Boon of Irresistible Offense',
    category: 'epic-boon',
    // SRD: "Increase your Strength or Dexterity score by 1, to a maximum of 30."
    requires: { kind: 'ability-score', spreads: [[1]], from: ['str', 'dex'] },
    minimumLevel: 19,
    repeatable: false,
    grants: { kind: 'ability-score-increase', maximum: 30 },
    note: 'Overcome Defenses is not applied: "the Bludgeoning, Piercing, and Slashing damage you deal always ignores Resistance" reads the target’s defences as an input to the attacker’s own damage, and applyDamage is the only reader of a defence. Overwhelming Strike is not applied either: extra damage on a natural 20, sized by the very score this feat raised.',
  },
  {
    id: 'boon-of-spell-recall',
    name: 'Boon of Spell Recall',
    category: 'epic-boon',
    // SRD: "Increase your Intelligence, Wisdom, or Charisma score by 1."
    requires: { kind: 'ability-score', spreads: [[1]], from: ['int', 'wis', 'cha'] },
    minimumLevel: 19,
    repeatable: false,
    grants: { kind: 'ability-score-increase', maximum: 30 },
    note: 'The second half of the bracket is not enforced: SRD prints "Prerequisite: Level 19+, Spellcasting Feature" and a feat gates on a level and on nothing else, so a character with no Spellcasting feature is not refused this boon. Free Casting is not applied either: rolling 1d4 against the slot’s level to refund it is a roll made inside a casting, which no grant hangs anything on.',
  },
  {
    id: 'boon-of-the-night-spirit',
    name: 'Boon of the Night Spirit',
    category: 'epic-boon',
    requires: { kind: 'ability-score', spreads: [[1]] },
    minimumLevel: 19,
    repeatable: false,
    grants: { kind: 'ability-score-increase', maximum: 30 },
    note: 'Merge with Shadows and Shadowy Form are not applied: both are gated on standing "within Dim Light or Darkness", which is a fact about where a creature is standing that no StandingRequirement asks; the first also gives its holder the Invisible condition, which no feature may impose.',
  },
  {
    id: 'boon-of-truesight',
    name: 'Boon of Truesight',
    category: 'epic-boon',
    requires: { kind: 'ability-score', spreads: [[1]] },
    minimumLevel: 19,
    repeatable: false,
    grants: { kind: 'ability-score-increase', maximum: 30 },
    note: 'Truesight with a range of 60 feet is not applied, and it is the one clause in this family the vocabulary could otherwise say: a sense standing grant is exactly that sentence. What stops it is that a feat carries one grant and this one is spent on the ceiling, which is the second-grant shape arriving at a feat’s door.',
  },
];

/**
 * SRD "Fighting Style Feats" — the four the SRD publishes.
 *
 * Their prerequisite is the Fighting Style *feature*, which is how the SRD
 * writes "only a class that grants this may take one". The feature's choice
 * names the category, and `checkFeats` already refuses a feat from the wrong
 * one, so the prerequisite is enforced by where the choice is offered rather
 * than by a rule here.
 *
 * **All four are declarations now**, and each wanted something different,
 * which an earlier version of this comment got wrong. It said three of them
 * wanted one *narrowing*; in fact only two ever did.
 *
 * | | The clause | What it wanted |
 * |---|---|---|
 * | **Archery** | "with **Ranged weapons**" | a weapon narrowing — built |
 * | **Great Weapon Fighting** | "a **Melee** weapon that you are **holding with two hands** … **Two-Handed or Versatile**" | the same narrowing, and a rule about the dice — built |
 * | **Defense** | "while you're **wearing Light, Medium, or Heavy armor**" | a `StandingRequirement` about **armour**, which is a different clause — built |
 * | **Two-Weapon Fighting** | "an extra attack as a result of using the **Light** property" | which Light weapon the turn had already swung — built |
 *
 * What the two narrowed ones needed besides the narrowing was a *reader*:
 * `FEAT_GRANT_KINDS` admits a grant kind only once `creation.ts` reads it off a
 * feat, and `standing` joined that list with `standingFromFeats`. So a feat
 * carries a standing grant now, which is why Defense's note names one blocker
 * rather than two.
 *
 * Great Weapon Fighting's arithmetic was always built — `treatLowRollsAs` in
 * the dice layer — and what was missing was a declaration asking for it and a
 * command supplying it. `StandingGrant`'s `attack-die-rule` is the first and
 * `standingDamageEffects` feeding `AttackOptions.damageEffects` is the second.
 * A spell says how its own dice behave through `SpellDefinition.dieRule`, and
 * this is the other scope of the same idea: a rule about every die an *attack*
 * throws rather than about one spell's.
 *
 * What `bonuses.ts` said when it was written — "whether Archery is in play is a
 * question about feats and inventory, which the engine does not model; the
 * layer that knows passes them in" — is retired for Archery: the sheet knows,
 * and the swing asks it.
 */
export const FIGHTING_STYLE_FEATS: readonly FeatDefinition[] = [
  {
    id: 'archery',
    name: 'Archery',
    category: 'fighting-style',
    requires: { kind: 'none' },
    repeatable: false,
    grants: {
      kind: 'standing',
      reach: 'self',
      effects: [
        {
          kind: 'flat-bonus',
          applies: ['attack'],
          flat: 2,
          onlyWithWeapon: { weapons: [{ kind: 'ranged' }] },
        },
      ],
    },
    note: 'Applied. The +2 is a named contribution on the attack roll, gathered by standingBonuses from the sheet rather than passed in by a caller, and "with Ranged weapons" is read off the weapon record the swing resolved - so a Shortbow gets it and the Longsword on the same belt does not.',
  },
  {
    id: 'defense',
    name: 'Defense',
    category: 'fighting-style',
    requires: { kind: 'none' },
    repeatable: false,
    grants: {
      kind: 'standing',
      reach: 'self',
      effects: [{ kind: 'flat-bonus', applies: ['ac'], flat: 1 }],
      // SRD: "While you're wearing Light, Medium, or Heavy armor" — the
      // armour slot, asked on every read, so the point goes the moment the
      // suit comes off and nothing has to remember it.
      requires: [{ kind: 'wearing-armor' }],
    },
    note: 'Applied. The +1 is a standing flat-bonus applying to ac, gathered by armorClassOf from the sheet exactly as magic armour\'s is, and "while you\'re wearing Light, Medium, or Heavy armor" is the wearing-armor requirement — the positive polarity of the axis unarmored and not-wearing-heavy-armor were the two negative ends of. It reads the armour slot alone, because the sentence names the three armour categories and not the Shield: a Fighter holding a Shield and wearing nothing gains nothing.',
  },
  {
    id: 'great-weapon-fighting',
    name: 'Great Weapon Fighting',
    category: 'fighting-style',
    requires: { kind: 'none' },
    repeatable: false,
    grants: {
      kind: 'standing',
      reach: 'self',
      effects: [
        {
          kind: 'attack-die-rule',
          rule: { kind: 'treat-low-rolls-as', atMost: 2, as: 3 },
          onlyWithWeapon: {
            weapons: [
              { kind: 'melee', properties: ['two-handed'] },
              { kind: 'melee', properties: ['versatile'] },
            ],
            heldInTwoHands: true,
          },
        },
      ],
    },
    note: 'Applied. The substitution is treatLowRollsAs in the dice layer, asked for by the grant and supplied to the swing as an attack-wide die rule, so a 1 or a 2 on a damage die counts as a 3 and the log shows what the die physically showed beside what it counted as. The narrowing is the sentence\'s own: a Melee weapon with the Two-Handed or Versatile property, held in two hands, which is the hand the attack itself declares. Attack-wide rather than weapon-only, which is what the printed sentence conditions on: a rider\'s die rolled for the same swing is raised with the blade\'s.',
  },
  {
    id: 'two-weapon-fighting',
    name: 'Two-Weapon Fighting',
    category: 'fighting-style',
    requires: { kind: 'none' },
    repeatable: false,
    grants: {
      kind: 'standing',
      reach: 'self',
      effects: [{ kind: 'light-extra-attack-damage' }],
    },
    note: 'Applied. SRD: "When you make an extra attack as a result of using a weapon that has the Light property, you can add your ability modifier to the damage of that attack if you aren\u2019t already adding it." The extra attack the Light property buys is a swing `resolveAttack` takes now \u2014 `lightAttack` says which price pays for it \u2014 and the property\u2019s own clause takes the modifier off its damage, which this puts back. The note used to say the engine did not model which hand an attack came from; the book never asks which hand, it asks which Light weapon this turn\u2019s Attack action already swung, and the turn budget records that.',
  },
];

/**
 * SRD 5.2.1 "Choose Languages", as the catalogue's own answer.
 *
 * "Your character knows at least three languages: Common plus two languages
 * you roll or choose from the Standard Languages table." Common is the one
 * every character speaks without spending a choice; the rest of the table is
 * what the two choices come from. The Rare Languages the book prints beside
 * them are a GM's to hand out rather than a character's to choose, and are
 * not transcribed yet — adding one is `availability: 'rare'` and nothing else.
 */
export const LANGUAGES: readonly LanguageDefinition[] = [
  { id: 'common', name: 'Common', availability: 'everyone' },
  { id: 'common-sign-language', name: 'Common Sign Language' },
  { id: 'draconic', name: 'Draconic' },
  { id: 'dwarvish', name: 'Dwarvish' },
  { id: 'elvish', name: 'Elvish' },
  { id: 'giant', name: 'Giant' },
  { id: 'gnomish', name: 'Gnomish' },
  { id: 'goblin', name: 'Goblin' },
  { id: 'halfling', name: 'Halfling' },
  { id: 'orc', name: 'Orc' },
];

/**
 * SRD 5.2.1 Step 4: "Choose your character's alignment... and note it on your
 * character sheet."
 *
 * The nine the book prints. Nothing in 2024 hangs off the choice
 * mechanically, so these are recorded rather than read from; they exist so a
 * typo cannot slip through as an alignment nobody has heard of, and a setting
 * with a different axis — or none — simply supplies its own.
 */
export const ALIGNMENTS: readonly AlignmentDefinition[] = [
  { id: 'lawful-good', name: 'Lawful Good' },
  { id: 'neutral-good', name: 'Neutral Good' },
  { id: 'chaotic-good', name: 'Chaotic Good' },
  { id: 'lawful-neutral', name: 'Lawful Neutral' },
  { id: 'neutral', name: 'Neutral' },
  { id: 'chaotic-neutral', name: 'Chaotic Neutral' },
  { id: 'lawful-evil', name: 'Lawful Evil' },
  { id: 'neutral-evil', name: 'Neutral Evil' },
  { id: 'chaotic-evil', name: 'Chaotic Evil' },
];
