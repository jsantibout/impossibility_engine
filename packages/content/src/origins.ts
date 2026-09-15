/**
 * SRD 5.2.1 species, backgrounds, feats, languages and alignments,
 * transcribed as data.
 *
 * Only what the supported creation paths need is here; adding the rest is
 * transcription onto the same structures, not design.
 */
import type {
  AlignmentDefinition,
  BackgroundDefinition,
  FeatDefinition,
  LanguageDefinition,
  SpeciesDefinition,
} from '@ie/engine';

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
      note: 'Heroic Inspiration is not modelled, so finishing a Long Rest does not grant it.',
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

export const SPECIES: readonly SpeciesDefinition[] = [HUMAN];
export const BACKGROUNDS: readonly BackgroundDefinition[] = [SAGE];

/** SRD "Origin Feats". The four the SRD publishes, no more. */
export const ORIGIN_FEATS: readonly FeatDefinition[] = [
  {
    id: 'alert',
    name: 'Alert',
    category: 'origin',
    requires: { kind: 'none' },
    repeatable: false,
    note: 'Initiative Proficiency is applied: creation returns it as a named bonus in initiativeBonuses, which rollInitiative takes like any other. The Initiative swap is not - swapping two combatants after the roll needs a decision nobody has modelled, and swapInitiative exists but nothing offers it.',
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
    note: 'Rolling weapon damage twice once per turn is not applied; the caller can reproduce it through the dice module.',
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
 * SRD "Fighting Style Feats" — the four the SRD publishes.
 *
 * Their prerequisite is the Fighting Style *feature*, which is how the SRD
 * writes "only a class that grants this may take one". The feature's choice
 * names the category, and `checkFeats` already refuses a feat from the wrong
 * one, so the prerequisite is enforced by where the choice is offered rather
 * than by a rule here.
 *
 * None is executed. Every one of them is a modifier the caller supplies, and
 * the engine has said so since `bonuses.ts` was written: "whether Archery is
 * in play is a question about feats and inventory, which the engine does not
 * model; the layer that knows passes them in."
 */
export const FIGHTING_STYLE_FEATS: readonly FeatDefinition[] = [
  {
    id: 'archery',
    name: 'Archery',
    category: 'fighting-style',
    requires: { kind: 'none' },
    repeatable: false,
    note: 'The +2 to attack rolls with Ranged weapons is a named bonus the caller passes to the roll; nothing adds it automatically.',
  },
  {
    id: 'defense',
    name: 'Defense',
    category: 'fighting-style',
    requires: { kind: 'none' },
    repeatable: false,
    note: 'The +1 to Armour Class while wearing armour is not applied: Armour Class is derived from the armour and Dexterity, and has no place for a feat yet.',
  },
  {
    id: 'great-weapon-fighting',
    name: 'Great Weapon Fighting',
    category: 'fighting-style',
    requires: { kind: 'none' },
    repeatable: false,
    note: 'Treating a 1 or 2 on a damage die as a 3 is `treatLowRollsAs` in the dice layer, which the caller opts into per roll; taking the feat does not switch it on.',
  },
  {
    id: 'two-weapon-fighting',
    name: 'Two-Weapon Fighting',
    category: 'fighting-style',
    requires: { kind: 'none' },
    repeatable: false,
    note: 'Adding the ability modifier to the off-hand attack is not applied; the engine does not model which hand an attack came from.',
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
