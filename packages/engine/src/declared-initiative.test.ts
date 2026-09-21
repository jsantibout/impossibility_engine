import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import {
  checkContent,
  extendContent,
  loadContent,
  type Content,
  type ContentInput,
} from './content.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent } from './events.js';
import { createRollIssuer } from './rolls.js';
import { rollInitiativeFor } from './commands.js';
import type { FeatDefinition } from './origins.js';
import { createCharacter, planCharacter, type CharacterChoices } from './creation.js';

/**
 * A feat's Initiative bonus, **declared by the feat** rather than paid out by
 * the engine.
 *
 * The rule the SRD prints under Alert is called Initiative Proficiency: "When
 * you roll Initiative, you can add your Proficiency Bonus to the roll." The
 * engine used to execute it by reading one feat's id — `feat.featId ===
 * 'alert'` in `creation.ts` — which is inviolable rule 4 broken mechanically
 * and was the last entry on `origin-and-feature-sweep.test.ts`'s breach
 * record: a catalogue without `alert` lost the rule, and a catalogue that
 * spelled it differently never got it.
 *
 * What replaces it is a member of the grant vocabulary. A feat *declares* that
 * it confers the bonus and creation reads the declaration, so this file asks
 * the two questions that distinction is for: the SRD's own feat still gets its
 * bonus, and a feat nobody wrote engine code for gets exactly the same one.
 *
 * The third question — that no engine file names the feat any more — is the
 * sweep's, and it is asked there by the record having no entry left in it.
 */

const id = (s: string) => asCharacterId(s);
const KESSA = id('kessa');

/** A level 3 Human Wizard, whose Versatile trait offers one Origin feat. */
const kessa = (featId: string): CharacterChoices => ({
  name: 'Kessa',
  classId: 'wizard',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Chaotic Good',
  subclassId: 'evoker',
  cantrips: ['fire-bolt', 'light', 'prestidigitation'],
  spellbook: [
    'magic-missile',
    'shield',
    'detect-magic',
    'feather-fall',
    'mage-armor',
    'sleep',
    'thunderwave',
    'charm-person',
    'misty-step',
    'web',
  ].map((spellId, index) => ({
    spellId,
    acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
    origin: 'level' as const,
  })),
  preparedSpells: [
    'magic-missile',
    'shield',
    'mage-armor',
    'sleep',
    'burning-hands',
    'scorching-ray',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'wizard:scholar': ['arcana'],
    'human:skillful': ['perception'],
    'evoker:evocation-savant': ['burning-hands', 'scorching-ray'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId },
  },
  dmGrants: {
    items: [],
    goldPieces: 0,
    magicItems: [],
    note: 'nothing beyond the standard package',
  },
});

const bonusesFrom = (content: Content, featId: string) =>
  unwrap(planCharacter(content, kessa(featId)), 'plan').initiativeBonuses;

/** What the Initiative roll actually added, read off the recorded roll. */
const rolledWith = (content: Content, featId: string): readonly string[] => {
  const log = unwrap(createCharacter(content, kessa(featId), KESSA), 'create');
  const state = fold('seed', log as readonly GameEvent[]);
  const roll = unwrap(
    rollInitiativeFor(state, KESSA, createRollIssuer('r'), createRng('init') as Rng),
    'initiative',
  );
  return roll.flatBonuses.map((bonus) => bonus.source);
};

describe('Alert gets its Initiative bonus because the feat declares it', () => {
  /**
   * SRD Alert, and the Proficiency Bonus of a level 3 character is +2. Read
   * off the plan, which is where the sheet's own bonuses are settled.
   */
  it('puts the Proficiency Bonus on the sheet, named for the feat', () => {
    expect(bonusesFrom(SRD_CONTENT, 'alert')).toEqual([{ source: 'Alert', flat: 2 }]);
  });

  /** And the declaration is the reason: a feat without it contributes none. */
  it('gives nothing to a feat that declares nothing', () => {
    expect(bonusesFrom(SRD_CONTENT, 'savage-attacker')).toEqual([]);
  });

  /** The bonus reaches the roll without a caller having to remember it. */
  it('rides on the Initiative roll the engine makes', () => {
    expect(rolledWith(SRD_CONTENT, 'alert')).toContain('Alert');
    expect(rolledWith(SRD_CONTENT, 'savage-attacker')).not.toContain('Alert');
  });

  /** The catalogue says it in the vocabulary, not in prose. */
  it('is declared on the feat rather than recorded in its note', () => {
    expect(SRD_CONTENT.featById('alert')?.grants).toEqual({
      kind: 'initiative',
      proficiency: true,
      swap: true,
    });
  });
});

/**
 * Rule 4, the half the breach record existed for: a feat nobody wrote engine
 * code for, declaring the same thing and getting the same bonus.
 */
describe('a homebrew feat declaring the same bonus gets the same bonus', () => {
  const WATCHFUL: FeatDefinition = {
    id: 'watchful',
    name: 'Watchful',
    category: 'origin',
    requires: { kind: 'none' },
    repeatable: false,
    note: 'Adds the Proficiency Bonus to Initiative, declared and executed.',
    grants: { kind: 'initiative', proficiency: true },
  };

  const homebrew = (): Content =>
    unwrap(extendContent(SRD_CONTENT, { feats: [WATCHFUL] }), 'extend');

  it('reaches the sheet under the homebrew feat’s own name', () => {
    expect(bonusesFrom(homebrew(), 'watchful')).toEqual([{ source: 'Watchful', flat: 2 }]);
  });

  it('reaches the roll the same way the SRD’s feat does', () => {
    expect(rolledWith(homebrew(), 'watchful')).toContain('Watchful');
  });

  /** Declared in JSON text and read back, which is the door homebrew uses. */
  it('survives the JSON door', () => {
    const loaded = unwrap(
      loadContent(JSON.parse(JSON.stringify({ feats: [WATCHFUL] }))),
      'load',
    );
    expect(loaded.featById('watchful')?.grants).toEqual({ kind: 'initiative', proficiency: true });
  });

  /**
   * And the *id* is not what is read: two feats spelled nothing alike, both
   * declaring the same grant, both paid. That is the difference between a
   * mechanic and a catalogue id, and it is the whole of what the breach on
   * the sweep's record got wrong.
   */
  it('reads the declaration and not the id', () => {
    const odd: FeatDefinition = { ...WATCHFUL, id: 'zz-nobody-would-guess', name: 'Weather Eye' };
    const content = unwrap(extendContent(SRD_CONTENT, { feats: [WATCHFUL, odd] }), 'extend');
    expect(bonusesFrom(content, 'watchful')).toEqual([{ source: 'Watchful', flat: 2 }]);
    expect(bonusesFrom(content, 'zz-nobody-would-guess')).toEqual([
      { source: 'Weather Eye', flat: 2 },
    ]);
  });
});

/**
 * A feat may declare only what creation executes.
 *
 * The same rule an item's conferral already keeps: a grant nothing reads is a
 * line in the book that quietly does nothing, which is the failure the content
 * validator exists to prevent. So the door is an allowlist with a path on it,
 * and it is the kinds creation reads off a feat rather than the whole grant
 * vocabulary.
 */
describe('what a feat may declare is held to what creation executes', () => {
  const featWith = (grants: unknown): ContentInput => ({
    feats: [
      {
        id: 'overreaching',
        name: 'Overreaching',
        category: 'origin',
        requires: { kind: 'none' },
        repeatable: false,
        note: 'claims more than a feat can declare',
        grants,
      } as unknown as FeatDefinition,
    ],
  });

  it('refuses a grant kind nothing reads off a feat, with a path', () => {
    const problems = checkContent(featWith({ kind: 'extra-attack', attacks: 2 }));
    expect(problems.map((problem) => `${problem.code} @ ${problem.field}`)).toEqual([
      'feat_grant_not_read @ feats[overreaching].grants.kind',
    ]);
  });

  it('refuses a grant that is not an object with a kind', () => {
    expect(checkContent(featWith({ attacks: 2 })).map((problem) => problem.code)).toEqual([
      'bad_feat_grant',
    ]);
    expect(checkContent(featWith('initiative')).map((problem) => problem.code)).toEqual([
      'bad_feat_grant',
    ]);
  });

  it('accepts the kind it does execute', () => {
    expect(checkContent(featWith({ kind: 'initiative', proficiency: true, swap: true }))).toEqual([]);
    // Either half alone is a whole sentence; SRD Alert prints both and a
    // homebrew feat may print one.
    expect(checkContent(featWith({ kind: 'initiative', proficiency: true }))).toEqual([]);
    expect(checkContent(featWith({ kind: 'initiative', swap: true }))).toEqual([]);
  });

  /**
   * And a grant about Initiative that raises neither flag changes nothing
   * about Initiative, which is a sentence somebody meant to finish.
   */
  it('refuses a grant that declares neither half', () => {
    expect(checkContent(featWith({ kind: 'initiative' })).map((problem) => problem.code)).toEqual([
      'empty_initiative_grant',
    ]);
  });

  /** The JSON door refuses the same thing, because half its input is untyped. */
  it('refuses the same through loadContent', () => {
    const loaded = loadContent(featWith({ kind: 'extra-attack', attacks: 2 }));
    expect(isErr(loaded)).toBe(true);
  });
});
