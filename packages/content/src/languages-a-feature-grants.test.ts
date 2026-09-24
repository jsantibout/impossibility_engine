/**
 * **Two class features that put a language on the sheet**, and the vocabulary
 * they needed.
 *
 * SRD Druidic: "You know Druidic, the secret language of Druids. While
 * learning this ancient tongue, you also unlocked the magic of communicating
 * with animals; you always have the _Speak with Animals_ spell prepared."
 *
 * SRD Thieves' Cant: "You picked up various languages in the communities where
 * you plied your roguish talents. You know Thieves' Cant and one other
 * language of your choice, which you choose from the language tables in
 * 'Character Creation.'"
 *
 * Both were `manual` with a note saying the language was "recorded as a
 * proficiency and read by nobody", and neither half of that was true: nothing
 * recorded it anywhere, because a character's languages were exactly the ones
 * `CharacterChoices.languages` named plus whatever the world gives everybody.
 * There was no door at all for a **feature** to put one on the sheet.
 *
 * So `language` is a `FeatureGrant` member for the half nobody chooses and a
 * `FeatureQuestion` member for the half they do — the same division `spells`
 * already draws between its `fixed` list and the `spell` question beside it.
 * Druidic's second sentence needed nothing new: a fixed `spells` grant is the
 * shape Paladin's Smite already uses.
 *
 * What stays the table's is what the languages are *for*: the hidden messages
 * a Druid leaves, the DC 15 Investigation check to spot one, and whatever a
 * Beast has to say. Those are a handover rather than a debt — no rule reads
 * them afterwards.
 */

import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import {
  checkCharacter,
  createCharacter,
  extendContent,
  planCharacter,
  type CharacterChoices,
} from '@ie/engine';
import { SRD_CONTENT } from './index.js';
import { LANGUAGES } from './origins.js';

const id = (s: string) => asCharacterId(s);

const common = {
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  equipped: [],
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
};

const druid = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  ...common,
  name: 'Fenn',
  classId: 'druid',
  level: 1,
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 13, con: 14, int: 8, wis: 15, cha: 12 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['nature', 'survival'],
  cantrips: ['poison-spray', 'guidance'],
  preparedSpells: ['cure-wounds', 'charm-person', 'thunderwave', 'animal-friendship'],
  featureChoices: {
    'human:skillful': ['perception'],
    'druid:primal-order': ['Magician'],
    'druid:primal-order:cantrip': ['mending'],
  },
  ...over,
});

const rogue = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  ...common,
  name: 'Wren',
  classId: 'rogue',
  level: 1,
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 15, con: 14, int: 13, wis: 12, cha: 8 },
  },
  abilityIncreases: { int: 2, wis: 1 },
  classSkills: ['stealth', 'acrobatics', 'perception', 'sleight-of-hand'],
  cantrips: [],
  preparedSpells: [],
  featureChoices: {
    'human:skillful': ['investigation'],
    'rogue:expertise': ['stealth', 'perception'],
    'rogue:weapon-mastery': [],
    'rogue:thieves-cant': ['Elvish'],
  },
  ...over,
});

const codesOf = (choices: CharacterChoices): readonly string[] =>
  checkCharacter(SRD_CONTENT, choices).map((one) => one.code);

const featureOf = (classId: string, featureId: string) =>
  SRD_CONTENT.classById(classId)?.features.find((one) => one.id === featureId);

describe('the catalogue holds the two Rare Languages a class grants', () => {
  /**
   * The Rare table's own sentence is the licence: "Some features let a
   * character learn a rare language." So the two the SRD's own classes grant
   * are transcribed, and `rare` keeps them off the Step 2 choice.
   */
  it('names Druidic and Thieves’ Cant, and neither is choosable at creation', () => {
    const rare = LANGUAGES.filter((one) => one.availability === 'rare');
    expect(rare.map((one) => one.name)).toEqual(['Druidic', "Thieves' Cant"]);
    expect(codesOf(druid({ languages: ['Druidic', 'Orc'] }))).toContain('unknown_language');
  });
});

describe('SRD Druidic: the language, and the spell always prepared', () => {
  it('declares both halves and nothing left for a DM', () => {
    const feature = featureOf('druid', 'druid:druidic');
    expect(feature?.automation).toBe('engine');
    expect(feature?.grants).toEqual([
      { kind: 'language', known: ['Druidic'] },
      { kind: 'spells', fixed: ['speak-with-animals'] },
    ]);
  });

  it('puts Druidic on a Druid 1’s sheet beside the two they chose', () => {
    const planned = unwrap(planCharacter(SRD_CONTENT, druid()), 'plan');
    expect(planned.languages).toEqual(['Common', 'Dwarvish', 'Orc', 'Druidic']);
  });

  /** And on nobody else's: a Rogue of the same world knows Common and two. */
  it('gives a Rogue no Druidic', () => {
    const planned = unwrap(planCharacter(SRD_CONTENT, rogue()), 'plan');
    expect(planned.languages).not.toContain('Druidic');
  });

  /**
   * "you always have the _Speak with Animals_ spell prepared" — the fixed
   * grant's shape: on the sheet without being one of the prepared spells the
   * class table counts, which is what makes it *always* prepared.
   */
  it('has Speak with Animals prepared without spending a prepared slot', () => {
    const planned = unwrap(planCharacter(SRD_CONTENT, druid()), 'plan');
    const route = planned.spellcasting.classes.find((one) => one.classId === 'druid');
    expect(route?.prepared).toContain('speak-with-animals');
    expect(druid().preparedSpells).not.toContain('speak-with-animals');
    // And the class table's own count is unmoved by it: the character is legal
    // with the prepared list they wrote, neither short nor over.
    expect(codesOf(druid())).toEqual([]);
  });

  it('creates through the public door', () => {
    expect(isErr(createCharacter(SRD_CONTENT, druid(), id('fenn')))).toBe(false);
  });
});

describe('SRD Thieves’ Cant: the Cant, and one other language of your choice', () => {
  it('declares the grant and the question', () => {
    const feature = featureOf('rogue', 'rogue:thieves-cant');
    expect(feature?.automation).toBe('engine');
    expect(feature?.grants).toEqual({ kind: 'language', known: ["Thieves' Cant"] });
    expect(feature?.choice).toEqual({ kind: 'language', choose: 1 });
  });

  it('knows Thieves’ Cant and the Elvish it chose', () => {
    const planned = unwrap(planCharacter(SRD_CONTENT, rogue()), 'plan');
    expect(planned.languages).toEqual([
      'Common',
      'Dwarvish',
      'Orc',
      "Thieves' Cant",
      'Elvish',
    ]);
    expect(codesOf(rogue())).toEqual([]);
  });

  /** "one **other** language" — against everything the character already has. */
  it('refuses a language this character already chose at creation', () => {
    expect(
      codesOf(rogue({ featureChoices: { ...rogue().featureChoices, 'rogue:thieves-cant': ['Orc'] } })),
    ).toContain('duplicate_language');
  });

  /** Including the one this very feature granted, which is what *other* is about. */
  it('refuses Thieves’ Cant itself', () => {
    expect(
      codesOf(
        rogue({
          featureChoices: { ...rogue().featureChoices, 'rogue:thieves-cant': ["Thieves' Cant"] },
        }),
      ),
    ).toContain('duplicate_language');
  });

  /** And the one everybody here speaks. */
  it('refuses Common', () => {
    expect(
      codesOf(
        rogue({ featureChoices: { ...rogue().featureChoices, 'rogue:thieves-cant': ['Common'] } }),
      ),
    ).toContain('duplicate_language');
  });

  it('refuses a tongue this world does not hold', () => {
    const problems = checkCharacter(
      SRD_CONTENT,
      rogue({
        featureChoices: { ...rogue().featureChoices, 'rogue:thieves-cant': ['Skyspeech'] },
      }),
    );
    const refusal = problems.find((one) => one.code === 'unknown_language');
    expect(refusal?.field).toBe('featureChoices');
    expect(refusal?.reason).toContain('Skyspeech');
  });

  /**
   * **An unanswered question warns rather than refuses**, which is the one
   * judgement in this track and is the corpus precedent rather than a reading
   * of the book: every Rogue written before the question existed omits it,
   * and "requiring the Weapon Mastery choice broke a corpus that spanned
   * worktrees" is on the record in `creation.ts`. The Cant is granted either
   * way; the other tongue arrives when somebody names it.
   */
  it('warns rather than refuses when nobody has picked', () => {
    const rest = Object.fromEntries(
      Object.entries(rogue().featureChoices).filter(([key]) => key !== 'rogue:thieves-cant'),
    );
    const bare = rogue({ featureChoices: rest });
    expect(codesOf(bare)).toEqual([]);
    const planned = unwrap(planCharacter(SRD_CONTENT, bare), 'plan');
    expect(planned.warnings.map((one) => one.code)).toContain('unclaimed_languages');
    // And the half the feature *grants* is there regardless.
    expect(planned.languages).toContain("Thieves' Cant");
    expect(planned.languages).not.toContain('Elvish');
  });

  /** Naming more than the sentence teaches is still an answer the rules refuse. */
  it('refuses two languages where the book teaches one', () => {
    expect(
      codesOf(
        rogue({
          featureChoices: {
            ...rogue().featureChoices,
            'rogue:thieves-cant': ['Elvish', 'Giant'],
          },
        }),
      ),
    ).toContain('too_many_languages');
  });

  /**
   * **The Rare table is open to the question and closed to Step 2**, which is
   * the whole of what the two sentences say differently: a Rogue may take
   * Druidic here and no character may take it there.
   */
  it('lets the question reach a Rare language', () => {
    const planned = unwrap(
      planCharacter(
        SRD_CONTENT,
        rogue({
          featureChoices: { ...rogue().featureChoices, 'rogue:thieves-cant': ['Druidic'] },
        }),
      ),
      'plan',
    );
    expect(planned.languages).toContain('Druidic');
  });

  it('creates through the public door', () => {
    expect(isErr(createCharacter(SRD_CONTENT, rogue(), id('wren')))).toBe(false);
  });
});

/**
 * And the vocabulary is vocabulary rather than these two features: a homebrew
 * world with its own tongue grants it through the same door, with no engine
 * change, which is the test inviolable rule 4 is held to.
 */
describe('a homebrew feature grants a homebrew language', () => {
  const world = unwrap(
    extendContent(SRD_CONTENT, {
      languages: [{ id: 'tide-cant', name: 'Tide Cant', availability: 'rare' }],
    }),
    'extend',
  );

  it('refuses a granted language this world does not hold', () => {
    const problems = extendContent(SRD_CONTENT, {
      classes: [
        {
          id: 'tidecaller',
          name: 'Tidecaller',
          hitDie: 8,
          table: Array.from({ length: 20 }, (_, i) => ({ level: i + 1, proficiencyBonus: 2 })),
          primaryAbility: 'cha' as const,
          saveProficiencies: ['con' as const, 'cha' as const],
          skillChoices: { choose: 2, from: ['nature' as const] },
          armorTraining: { light: true, medium: false, heavy: false, shields: false },
          weaponProficiencies: ['simple'],
          startingEquipment: [
            { option: 'A', items: [], goldPieces: 0 },
            { option: 'B', items: [], goldPieces: 0 },
          ],
          subclassLevel: 3,
          multiclass: {
            weapons: [],
            armorTraining: { light: false, medium: false, heavy: false, shields: false },
            tools: [],
          },
          features: [
            {
              id: 'tidecaller:tongue',
              name: 'Tongue of the Tide',
              level: 1,
              automation: 'engine',
              note: 'Grants a language this world has never heard of.',
              grants: { kind: 'language', known: ['Deep Hymn'] },
            },
          ],
        },
      ],
    });
    expect(isErr(problems)).toBe(true);
    if (!isErr(problems)) return;
    expect(problems.reason).toContain('Deep Hymn');
  });

  it('holds the tongue it does hold', () => {
    expect(world.languageNamed('Tide Cant')?.availability).toBe('rare');
  });
});
