import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type Ability } from '@ie/shared';
import {
  advanceCharacter,
  createCharacter,
  createRng,
  createRollIssuer,
  declaredCasting,
  fold,
  freeCastPoolKey,
  planCharacter,
  READABLE_GRANT_KINDS,
  remaining,
  resolveSpell,
  resolveTest,
  speedOf,
  type CharacterChoices,
  type FeatChoice,
  type FeatureDefinition,
  type GameEvent,
  type GameState,
  type Rng,
} from '@ie/engine';

/**
 * Species and backgrounds, held against the book that prints them.
 *
 * The roster is **read from `character-origins.md`** rather than typed out
 * here, because a hand-written list of what the SRD publishes is a second
 * transcription and would agree with the first by construction. The raw file
 * prints its species and backgrounds as `####` headings under two sections,
 * so the test asks the file and the catalogue the same question.
 */

const RAW = readFileSync(
  fileURLToPath(new URL('../../srd/raw/character-origins.md', import.meta.url)),
  'utf8',
);

/** The `####` headings under one `###` section, up to the next heading of any rank. */
function printedUnder(section: string): readonly string[] {
  const lines = RAW.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `### ${section}`);
  if (start < 0) throw new Error(`no "${section}" section in character-origins.md`);
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,3} /.test(line)) break;
    const heading = /^#### (.+)$/.exec(line.trim());
    if (heading?.[1] !== undefined) names.push(heading[1]);
  }
  if (names.length === 0) throw new Error(`no entries under "${section}"`);
  return names;
}

/** The id a name is filed under: the same slug the SRD parsers assign. */
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const PRINTED_SPECIES = printedUnder('Species Descriptions');
const PRINTED_BACKGROUNDS = printedUnder('Background Descriptions');

describe('every origin the SRD prints is in the catalogue', () => {
  it('finds the nine species and the four backgrounds in the book', () => {
    expect(PRINTED_SPECIES).toEqual([
      'Dragonborn',
      'Dwarf',
      'Elf',
      'Gnome',
      'Goliath',
      'Halfling',
      'Human',
      'Orc',
      'Tiefling',
    ]);
    expect(PRINTED_BACKGROUNDS).toEqual(['Acolyte', 'Criminal', 'Sage', 'Soldier']);
  });

  it('holds every species the book prints, by id and by name', () => {
    expect(SRD_CONTENT.species.map((s) => s.id).sort()).toEqual(
      [...PRINTED_SPECIES].map(slug).sort(),
    );
    for (const name of PRINTED_SPECIES) {
      expect(SRD_CONTENT.speciesById(slug(name))?.name, name).toBe(name);
    }
  });

  it('holds every background the book prints, by id and by name', () => {
    expect(SRD_CONTENT.backgrounds.map((b) => b.id).sort()).toEqual(
      [...PRINTED_BACKGROUNDS].map(slug).sort(),
    );
    for (const name of PRINTED_BACKGROUNDS) {
      expect(SRD_CONTENT.backgroundById(slug(name))?.name, name).toBe(name);
    }
  });
});

/** The lines of one `####` entry, up to the next heading of any rank. */
function blockFor(name: string): readonly string[] {
  const lines = RAW.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `#### ${name}`);
  if (start < 0) throw new Error(`no "${name}" in character-origins.md`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,4} /.test(line));
  return end < 0 ? rest : rest.slice(0, end);
}

/** The text after one of the bolded labels the book prints above a trait. */
function printed(name: string, label: string): string {
  const line = blockFor(name).find((text) => text.startsWith(`**${label}:**`));
  if (line === undefined) throw new Error(`${name} prints no "${label}"`);
  return line.slice(`**${label}:**`.length).trim();
}

const ABILITY_OF: Readonly<Record<string, Ability>> = {
  Strength: 'str',
  Dexterity: 'dex',
  Constitution: 'con',
  Intelligence: 'int',
  Wisdom: 'wis',
  Charisma: 'cha',
};

describe('a species carries the creature type, size and Speed the book prints', () => {
  it.each(PRINTED_SPECIES.map((name) => [name] as const))('%s', (name) => {
    const species = SRD_CONTENT.speciesById(slug(name));
    expect(species, name).not.toBeNull();
    if (species === null) return;

    expect(species.creatureType).toBe(printed(name, 'Creature Type'));
    // "Medium (about 4–7 feet tall) or Small (...), chosen when you select
    // this species" is two sizes and a parenthesis; the size words are the
    // claim, in the order the book makes them.
    expect(species.sizes).toEqual(printed(name, 'Size').match(/\b(?:Tiny|Small|Medium|Large)\b/g));
    expect(`${species.speed} feet`).toBe(printed(name, 'Speed'));
  });
});

describe('a background carries the abilities, feat, proficiencies and purse the book prints', () => {
  it.each(PRINTED_BACKGROUNDS.map((name) => [name] as const))('%s', (name) => {
    const background = SRD_CONTENT.backgroundById(slug(name));
    expect(background, name).not.toBeNull();
    if (background === null) return;

    expect(background.abilities).toEqual(
      printed(name, 'Ability Scores')
        .split(', ')
        .map((ability) => ABILITY_OF[ability]),
    );

    // SRD prints "Magic Initiate (Cleric) (see "Feats")"; the cross-reference
    // is not part of the feat's name.
    expect(background.feat).toBe(printed(name, 'Feat').replace(/\s*\(see "Feats"\)$/, ''));

    expect(background.skillProficiencies).toEqual(
      printed(name, 'Skill Proficiencies')
        .split(' and ')
        .map((skill) => slug(skill)),
    );

    // "_Choose one kind of_ Gaming Set (see "Equipment")" names a category and
    // leaves the kind to the player, so the claim is that the tool the sheet
    // records is the one the line names.
    expect(printed(name, 'Tool Proficiency')).toContain(background.toolProficiency);

    // "(A) ... , 8 GP; or (B) 50 GP" — both purses, from the one line.
    const purses = printed(name, 'Equipment').match(/(\d+) GP/g) ?? [];
    expect(background.startingEquipment.map((pack) => `${pack.goldPieces} GP`)).toEqual(purses);
  });
});

/**
 * A character on each origin, through the public door.
 *
 * A Fighter, because a species trait must land on a character who casts
 * nothing — and because the two skills a Fighter chooses here overlap none of
 * the four backgrounds, so a redundant proficiency warning would be a real
 * finding rather than noise.
 */

const WHO = asCharacterId('who');
const CASTER = asCharacterId('caster');

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** SRD: "Increase one by 2 and another one by 1", from each background's three. */
const INCREASES: Readonly<Record<string, Readonly<Partial<Record<Ability, number>>>>> = {
  acolyte: { int: 2, wis: 1 },
  criminal: { dex: 2, con: 1 },
  sage: { con: 2, int: 1 },
  soldier: { str: 2, dex: 1 },
};

const BACKGROUND_FEATS: Readonly<Record<string, Readonly<Record<string, FeatChoice>>>> = {
  acolyte: {
    'acolyte:magic-initiate-cleric': {
      featId: 'magic-initiate',
      spellList: 'cleric',
      spellcastingAbility: 'wis',
      cantrips: ['sacred-flame', 'guidance'],
      levelOneSpell: 'cure-wounds',
    },
  },
  criminal: { 'criminal:alert': { featId: 'alert' } },
  sage: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
  },
  soldier: { 'soldier:savage-attacker': { featId: 'savage-attacker' } },
};

/** What each species asks the player to decide, answered. */
const SPECIES_CHOICES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  dragonborn: { 'dragonborn:draconic-ancestry': ['Silver'] },
  dwarf: {},
  elf: { 'elf:elven-lineage': ['High Elf'], 'elf:keen-senses': ['perception'] },
  gnome: { 'gnome:gnomish-lineage': ['Rock Gnome'] },
  goliath: { 'goliath:giant-ancestry': ["Stone's Endurance"] },
  halfling: {},
  human: { 'human:skillful': ['perception'] },
  orc: {},
  tiefling: { 'tiefling:fiendish-legacy': ['Infernal'] },
};

const SPECIES_FEATS: Readonly<Record<string, Readonly<Record<string, FeatChoice>>>> = {
  human: {
    'human:versatile': {
      featId: 'skilled',
      proficiencies: ['investigation', 'medicine', 'nature'],
    },
  },
};

const choicesFor = (speciesId: string, backgroundId: string): CharacterChoices => ({
  name: 'Wren',
  classId: 'fighter',
  level: 1,
  speciesId,
  backgroundId,
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: INCREASES[backgroundId] ?? {},
  classSkills: ['acrobatics', 'animal-handling'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: SPECIES_CHOICES[speciesId] ?? {},
  feats: {
    'fighter:fighting-style': { featId: 'defense' },
    ...(SPECIES_FEATS[speciesId] ?? {}),
    ...(BACKGROUND_FEATS[backgroundId] ?? {}),
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const stateOf = (choices: CharacterChoices): GameState =>
  fold('seed', unwrap(createCharacter(SRD_CONTENT, choices, WHO), 'creation') as GameEvent[]);

describe('a character is created and advanced on every species', () => {
  it.each(PRINTED_SPECIES.map((name) => [name, slug(name)] as const))(
    '%s reaches the sheet as printed',
    (name, speciesId) => {
      const choices = choicesFor(speciesId, 'sage');
      const plan = unwrap(planCharacter(SRD_CONTENT, choices), `${name} plan`);

      expect(plan.creatureType).toBe(printed(name, 'Creature Type'));
      // The Speed the rules are measured against, not the field it came from —
      // which is how the Goliath's 35 feet is a real answer and not a number
      // sitting on a sheet nobody reads.
      expect(speedOf(stateOf(choices), WHO)).toBe(SRD_CONTENT.speciesById(speciesId)?.speed);
      expect(plan.warnings).toEqual([]);

      // And it levels: advancement emits the difference rather than rebuilding
      // the character, so a species that creation accepts must survive it.
      const advanced = advanceCharacter(stateOf(choices), SRD_CONTENT, WHO, {});
      expect(advanced.ok, `${name} at level 2`).toBe(true);
    },
  );
});

describe('a character is created and advanced on every background', () => {
  it.each(PRINTED_BACKGROUNDS.map((name) => [name, slug(name)] as const))(
    '%s reaches the sheet as printed',
    (name, backgroundId) => {
      const background = SRD_CONTENT.backgroundById(backgroundId);
      const choices = choicesFor('human', backgroundId);
      const plan = unwrap(planCharacter(SRD_CONTENT, choices), `${name} plan`);

      for (const skill of background?.skillProficiencies ?? []) {
        expect(plan.sheet.skills[skill], `${name} grants ${skill}`).toBe('proficient');
      }
      expect(plan.toolProficiencies).toContain(background?.toolProficiency);

      // The Origin feat the background names, on the sheet under the feature
      // that granted it.
      const granted = Object.keys(BACKGROUND_FEATS[backgroundId] ?? {})[0] ?? '';
      expect(plan.feats.some((feat) => feat.endsWith(`(${granted})`)), name).toBe(true);

      // SRD: the character starts with the package's purse on top of the
      // class's, and option A is the one these choices take.
      const purse = background?.startingEquipment.find((pack) => pack.option === 'A');
      expect(plan.goldPieces).toBeGreaterThanOrEqual(purse?.goldPieces ?? 0);
      expect(plan.warnings).toEqual([]);

      const advanced = advanceCharacter(stateOf(choices), SRD_CONTENT, WHO, {});
      expect(advanced.ok, `${name} at level 2`).toBe(true);
    },
  );
});

const ORIGIN_FEATURES: readonly FeatureDefinition[] = [
  ...SRD_CONTENT.species.flatMap((species) => species.features),
  ...SRD_CONTENT.backgrounds.flatMap((background) => background.features),
];

/**
 * The claim the coverage report cannot check for itself.
 *
 * `class-pools.test.ts` made it for class features — "a feature that claims a
 * pool declares one" — and a species is where it is most tempting to get
 * wrong, because most of these traits are mechanics the engine has never had.
 * A feature marked `engine` that no reader reaches is the one failure this
 * catalogue can produce silently.
 */
describe('a species or background feature marked engine is one something reads', () => {
  it('has some, so the rule below is not vacuous', () => {
    expect(ORIGIN_FEATURES.filter((f) => f.automation === 'engine').length).toBeGreaterThan(2);
  });

  it.each(
    ORIGIN_FEATURES.filter((f) => f.automation === 'engine').map((f) => [f.id, f] as const),
  )('%s declares something a reader reaches', (_id, feature) => {
    // The three routes, and every one of them is code that dereferences the
    // field: a readable grant (`READABLE_GRANT_KINDS`, which is the engine's
    // own list), a skill choice (`gatherProficiencies` adds it), or a granted
    // feat (`checkFeats` validates it and `planCharacter` records it).
    const readable =
      (feature.grants !== undefined && READABLE_GRANT_KINDS.has(feature.grants.kind)) ||
      feature.choice?.kind === 'skill' ||
      feature.choice?.kind === 'feat' ||
      feature.grantsFeat !== undefined;
    expect(readable).toBe(true);
  });

  /** SRD Keen Senses: "proficiency in the Insight, Perception, or Survival skill." */
  it('puts the Elf’s chosen skill on the sheet', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT, choicesFor('elf', 'sage')), 'elf');
    expect(plan.sheet.skills['perception']).toBe('proficient');

    const wrong = planCharacter(SRD_CONTENT, {
      ...choicesFor('elf', 'sage'),
      featureChoices: { 'elf:elven-lineage': ['High Elf'], 'elf:keen-senses': ['athletics'] },
    });
    expect(wrong.ok).toBe(false);
  });

  /** SRD Gnomish Cunning: "Advantage on Intelligence, Wisdom, and Charisma saving throws." */
  it.each([
    ['int', true],
    ['wis', true],
    ['cha', true],
    ['dex', false],
    ['str', false],
    ['con', false],
  ] as const)('gives the Gnome Advantage on a %s save: %s', (ability, expected) => {
    const state = stateOf(choicesFor('gnome', 'sage'));
    const save = unwrap(
      resolveTest(state, WHO, { kind: 'saving-throw', ability, dc: 10 }, supply(`save-${ability}`)),
      'save',
    );
    expect(save.test?.modeSources.map((mode) => mode.source) ?? []).toEqual(
      expected ? ['Gnomish Cunning'] : [],
    );
    expect(save.test?.mode).toBe(expected ? 'advantage' : 'normal');
  });

  /**
   * SRD Elven Lineage, Wood Elf: "Your Speed increases to 35 feet."
   *
   * One benefit of one lineage out of three, which is why the feature stays
   * `manual` — and why the grant is gated on the option the player took
   * rather than handed to every Elf.
   */
  it.each([
    ['Wood Elf', 35],
    ['High Elf', 30],
    ['Drow', 30],
  ] as const)('gives a %s Elf a Speed of %i', (lineage, feet) => {
    const choices = {
      ...choicesFor('elf', 'sage'),
      featureChoices: { 'elf:elven-lineage': [lineage], 'elf:keen-senses': ['perception'] },
    };
    expect(speedOf(stateOf(choices), WHO)).toBe(feet);
  });

  /** SRD Alert, which the Criminal background grants: "add your Proficiency Bonus". */
  it('puts the Criminal’s Alert on the Initiative roll', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT, choicesFor('human', 'criminal')), 'criminal');
    expect(plan.initiativeBonuses.map((bonus) => bonus.flat)).toEqual([plan.proficiencyBonus]);
  });

  /**
   * SRD Magic Initiate: the level 1 spell is castable once a day without a
   * slot, which is a pool — and the Acolyte's is pinned to the Cleric list.
   */
  it('gives the Acolyte a Cleric Magic Initiate, list and all', () => {
    const choices = choicesFor('human', 'acolyte');
    const state = stateOf(choices);
    expect(
      remaining(state.creatures[WHO]!.resources, freeCastPoolKey('acolyte:magic-initiate-cleric')),
    ).toBe(1);

    const plan = unwrap(planCharacter(SRD_CONTENT, choices), 'acolyte');
    expect(plan.spellcasting.granted.map((route) => route.spellId).sort()).toEqual([
      'cure-wounds',
      'guidance',
      'sacred-flame',
    ]);

    // The background fixed the list, so a Wizard's cantrip off the same feat
    // is refused rather than quietly filed.
    const offList = planCharacter(SRD_CONTENT, {
      ...choices,
      feats: {
        ...choices.feats,
        'acolyte:magic-initiate-cleric': {
          featId: 'magic-initiate',
          spellList: 'wizard',
          spellcastingAbility: 'int',
          cantrips: ['mage-hand', 'light'],
          levelOneSpell: 'find-familiar',
        },
      },
    });
    expect(offList.ok).toBe(false);
  });

  /**
   * And the other direction: a **manual** feature whose note says half of it
   * *is* applied has to be telling the truth.
   *
   * SRD Dwarven Resilience: "You have Resistance to Poison damage." The note
   * says the Resistance is applied and the Advantage on saves against the
   * Poisoned condition is not, so the halving is a claim this file owes.
   */
  it('halves Poison damage for a Dwarf and nobody else', () => {
    /**
     * A real cast rather than a hand-made damage packet: Resistance is read
     * inside the one place damage is applied, so this is the only way to show
     * it reaches a character the catalogue built. The caster's Intelligence is
     * absurd on purpose — a spell attack that cannot miss takes the roll out
     * of the comparison and leaves the halving.
     */
    const hurt = (speciesId: string): number => {
      const choices = choicesFor(speciesId, 'sage');
      const log: GameEvent[] = [
        ...(unwrap(createCharacter(SRD_CONTENT, choices, WHO), 'creation') as GameEvent[]),
        {
          type: 'creature-added',
          id: CASTER,
          name: 'the caster',
          sheet: {
            level: 1,
            abilities: { str: 10, dex: 10, con: 10, int: 40, wis: 10, cha: 10 },
            skills: {},
            saveProficiencies: [],
            armor: null,
            shield: null,
            armorTraining: { light: true, medium: true, heavy: true, shields: true },
            baseSpeed: 30,
            spellcastingAbility: 'int',
          },
          maxHp: 50,
          diesAtZero: false,
          creatureType: 'Humanoid',
        },
        { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
        { type: 'landmark-added', name: 'the door', at: { x: 50, y: 50, z: 0 } },
        { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'the door' }, feet: 0 } },
        { type: 'creature-placed', id: WHO, placement: { from: { creature: CASTER }, feet: 5, bearing: 90 } },
        { type: 'sight-declared', from: CASTER, to: WHO, seen: true },
        {
          type: 'spellcasting-declared',
          id: CASTER,
          spellcasting: declaredCasting({
            ability: 'int',
            classId: 'wizard',
            cantrips: ['poison-spray'],
            prepared: [],
          }),
        },
      ];

      const before = fold('seed', log);
      const cast = unwrap(
        resolveSpell(before, CASTER, { spellId: 'poison-spray', targets: [WHO] }, supply('spray')),
        'poison spray',
      );
      const after = fold('seed', [...log, ...cast.events]);
      return (
        (before.creatures[WHO]?.vitals.hp ?? 0) - (after.creatures[WHO]?.vitals.hp ?? 0)
      );
    };

    const toDwarf = hurt('dwarf');
    const toHuman = hurt('human');
    expect(toHuman).toBeGreaterThan(0);
    expect(toDwarf).toBe(Math.floor(toHuman / 2));
  });
});

/**
 * The other half of the same honesty, and the half `COVERAGE.md` cannot count
 * without: a `manual` feature that says nothing leaves a DM with a trait on
 * the sheet and no idea what it is owed.
 */
describe('a species or background feature marked manual says what is left to do', () => {
  it.each(
    ORIGIN_FEATURES.filter((f) => f.automation === 'manual').map((f) => [f.id, f] as const),
  )('%s carries a note', (_id, feature) => {
    expect(feature.note.trim().length).toBeGreaterThan(0);
    // A bare negation naming nothing is the failure mode, not an empty string.
    expect(feature.note.trim()).not.toMatch(
      /^(?:this )?(?:feature |it )?(?:is )?not (?:modelled|automated|implemented|applied)\.?$/i,
    );
  });
});
