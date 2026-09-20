import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import { checkContent, extendContent, parseClassDefinition } from './content.js';
import { resolveTest } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { createRng, restoreRng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { standingCheckBonuses } from './standing.js';

/**
 * A bonus to named ability checks, sized by a modifier on the holder's own
 * sheet.
 *
 * SRD writes it twice in the same words — Divine Order (Thaumaturge) and
 * Primal Order (Magician), "the bonus equals your Wisdom modifier (minimum of
 * +1)" over two named skills each — and until `check-bonus` the engine had one
 * ability-derived bonus and it was a saving throw's: `save-bonus` is Aura of
 * Protection, "the *holder's* modifier, read off their sheet rather than the
 * beneficiary's", and `flat-bonus` beside it is "Flat, and only flat".
 *
 * The class below is neither of the two SRD writers, which is the point: it is
 * loaded from JSON text through the public door, its bonus is sized by a
 * different ability over different skills, and it is gated on one option of a
 * choice. Nothing in the engine names it.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const TIDE = id('tide');

const TIDECALLER = {
  id: 'tidecaller',
  name: 'Tidecaller',
  primaryAbility: 'wis',
  hitDie: 8,
  saveProficiencies: ['wis', 'cha'],
  skillChoices: { choose: 2, from: ['athletics', 'arcana', 'survival', 'insight'] },
  weaponProficiencies: ['simple'],
  armorTraining: { light: true, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: Array.from({ length: 20 }, (_, index) => ({
    level: index + 1,
    proficiencyBonus: 2 + Math.floor(index / 4),
  })),
  startingEquipment: [{ option: 'A', items: [{ id: 'quarterstaff', quantity: 1 }], goldPieces: 5 }],
  multiclass: {
    weapons: ['simple'],
    armorTraining: { light: true, medium: false, heavy: false, shields: false },
    tools: [],
  },
  features: [
    {
      id: 'tidecaller:tidal-lore',
      name: 'Tidal Lore',
      level: 1,
      automation: 'engine',
      note: 'Lorekeeper gives you a bonus to Arcana and History checks equal to your Wisdom modifier (minimum of +1). Tidewarden gives you nothing this engine reads.',
      choice: { kind: 'option', choose: 1, from: ['Lorekeeper', 'Tidewarden'] },
      grants: {
        kind: 'standing',
        reach: 'self',
        onlyIfChoice: 'Lorekeeper',
        effects: [
          { kind: 'check-bonus', fromAbility: 'wis', minimum: 1, skills: ['arcana', 'history'] },
        ],
      },
    },
  ],
};

const parsed = unwrap(parseClassDefinition(JSON.parse(JSON.stringify(TIDECALLER))), 'parse');
const content = unwrap(extendContent(SRD_CONTENT, { classes: [parsed] }), 'extend');

const tidecaller = (option: string, dim = false): CharacterChoices => ({
  name: 'Ilka',
  classId: 'tidecaller',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    // The standard array either way; `dim` swaps the 15 and the 8 so the
    // modifier the feature reads is negative and the floor has work to do.
    assignment: dim
      ? { str: 15, dex: 14, con: 13, int: 12, wis: 8, cha: 10 }
      : { str: 8, dex: 14, con: 13, int: 12, wis: 15, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'arcana'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'], 'tidecaller:tidal-lore': [option] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'medicine'] },
  },
});

const built = (option: string, dim = false): GameState =>
  fold('seed', unwrap(createCharacter(content, tidecaller(option, dim), TIDE), 'create'));

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: state.rng === null ? createRng('seed') : restoreRng(state.rng),
  content,
});

/** What the log says contributed to a check of this skill. */
const contributions = (
  state: GameState,
  skill: 'arcana' | 'history' | 'athletics',
): readonly { readonly source: string; readonly amount: number }[] => {
  const rolled = unwrap(
    resolveTest(state, TIDE, { kind: 'ability-check', ability: 'int', skill, dc: 10 }, supply(state)),
    'test',
  );
  const record = rolled.events.find((event: GameEvent) => event.type === 'roll-recorded');
  return record !== undefined && record.type === 'roll-recorded' ? record.contributions : [];
};

describe('a bonus an ability modifier sizes', () => {
  it('is validated beside the printed classes and adds no problem', () => {
    expect(checkContent({ classes: [parsed] })).toEqual([]);
  });

  /** The gate is the standing grant's own, and the other option grants nothing. */
  it('reaches the sheet for the option that grants it and no other', () => {
    const kept = built('Lorekeeper').creatures[TIDE]?.sheet.standing ?? [];
    expect(kept.map((effect) => effect.grant.kind)).toEqual(['check-bonus']);
    expect(built('Tidewarden').creatures[TIDE]?.sheet.standing ?? []).toEqual([]);
  });

  /**
   * Wisdom 15 plus the background's point is 16, so the bonus is +3 — read off
   * the holder's sheet at the moment of the roll, the way a save bonus is.
   */
  it('adds the holder’s modifier to a named skill, and the floor when that is higher', () => {
    expect(standingCheckBonuses(built('Lorekeeper'), TIDE, 'arcana')).toEqual([
      { source: 'Tidal Lore', flat: 3 },
    ]);
    expect(standingCheckBonuses(built('Lorekeeper'), TIDE, 'history')).toEqual([
      { source: 'Tidal Lore', flat: 3 },
    ]);
    // "(minimum of +1)": a Wisdom of 9 is a −1 modifier and the floor holds.
    expect(standingCheckBonuses(built('Lorekeeper', true), TIDE, 'arcana')).toEqual([
      { source: 'Tidal Lore', flat: 1 },
    ]);
  });

  it('says nothing about a skill it does not name, or a holder who did not take it', () => {
    expect(standingCheckBonuses(built('Lorekeeper'), TIDE, 'athletics')).toEqual([]);
    expect(standingCheckBonuses(built('Tidewarden'), TIDE, 'arcana')).toEqual([]);
  });

  /** End to end: the roll carries it, named, and a check of another skill does not. */
  it('reaches the check the command rolls, and the log says why', () => {
    expect(contributions(built('Lorekeeper'), 'arcana')).toContainEqual({
      source: 'Tidal Lore',
      amount: 3,
    });
    expect(contributions(built('Lorekeeper'), 'athletics')).not.toContainEqual({
      source: 'Tidal Lore',
      amount: 3,
    });
    expect(contributions(built('Tidewarden'), 'arcana')).not.toContainEqual({
      source: 'Tidal Lore',
      amount: 3,
    });
  });

  /**
   * A benefit that could never hold is refused at the door, which is the rule
   * the whole content validator follows.
   */
  it('refuses a bonus over no skills, and one over a skill nobody has', () => {
    const withSkills = (skills: readonly string[]): readonly string[] => {
      const written = JSON.parse(JSON.stringify(TIDECALLER)) as typeof TIDECALLER;
      const grants = written.features[0]?.grants as { effects: { skills: readonly string[] }[] };
      grants.effects[0]!.skills = skills;
      return checkContent({ classes: [written as never] }).map(
        (problem) => `${problem.code} @ ${problem.field}`,
      );
    };
    expect(withSkills([])).toContain(
      'bonus_over_no_skills @ classes[tidecaller].features[0].grants.effects[0].skills',
    );
    expect(withSkills(['plumbing'])).toContain(
      'unknown_skill @ classes[tidecaller].features[0].grants.effects[0].skills',
    );
  });
});
