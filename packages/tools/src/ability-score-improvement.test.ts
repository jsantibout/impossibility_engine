/**
 * The Ability Score Improvement, taken through the door a model uses.
 *
 * SRD prints one feat at the centre of every character above level 3:
 * "Increase one ability score of your choice by 2, or increase two ability
 * scores of your choice by 1." The catalogue has carried it since the
 * advancement batch, the engine's creation path validates the answer, and
 * `featChoice` had no field to say it in — so a caller on this surface could
 * name the feat and never name the scores, and every level 5 fixture in
 * `routes.test.ts` had to spend its level 4 feat on `savage-attacker`
 * instead. A feat this repository published and its own tool surface cannot
 * choose is a door shut on the book.
 *
 * **The field mirrors the engine's vocabulary rather than re-judging it.**
 * `FeatChoice.abilities` is a list of plain strings, one entry per point,
 * because the engine wants to answer `unknown_ability` itself and name the
 * choice at fault. So the schema checks the shape — a list of non-empty
 * strings — and the three refusals below all come from `checkFeats`, which
 * is the only place the sentence is judged. A Zod enum here would be a second
 * rules engine that could disagree with the first, which is the reason this
 * file's neighbour gives for not checking whether `wizard` is a class.
 *
 * Driven through `create_character` and read off the folded sheet, so what is
 * proved is that the points the caller named reached the character — not that
 * a schema accepted a key.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  createCampaign,
  createSurface,
  type Campaign,
  type RefusedOutcome,
  type ToolOutcome,
} from '@ie/tools';

/**
 * A level 5 Cleric, which is the shortest road to the feat: the class grants
 * it at level 4 and the SRD gates it at "Level 4+".
 *
 * Wisdom is 15 assigned, 17 once the background's own +2 lands, and the
 * Improvement is the only thing that could take it further — which is what
 * makes the number below about this feat.
 */
const cleric = (feats: Record<string, unknown>): Record<string, unknown> => ({
  name: 'Brannor',
  classId: 'cleric',
  level: 5,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 14, dex: 12, con: 13, int: 10, wis: 15, cha: 8 },
  },
  abilityIncreases: { wis: 2, con: 1 },
  classSkills: ['insight', 'religion'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  subclassId: 'life-domain',
  cantrips: ['sacred-flame', 'guidance', 'light', 'thaumaturgy'],
  spellbook: [],
  preparedSpells: [
    'spirit-guardians',
    'inflict-wounds',
    'healing-word',
    'bane',
    'blindness-deafness',
    'hold-person',
    'guiding-bolt',
    'aid',
    'silence',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'cleric:divine-order': ['Protector'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    ...feats,
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

/** The level 4 feat slot, answered with the Improvement and a spread. */
const improving = (abilities: readonly string[] | undefined): Record<string, unknown> => ({
  'cleric:ability-score-improvement': {
    featId: 'ability-score-improvement',
    ...(abilities === undefined ? {} : { abilities }),
  },
});

interface Table {
  readonly campaign: Campaign;
  create(choices: Record<string, unknown>): ToolOutcome;
}

function table(seed: string): Table {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  return {
    campaign,
    create: (choices) => {
      calls += 1;
      return surface.call({
        tool: 'create_character',
        input: { id: 'brannor', choices },
        commandId: `toolu_${calls}`,
      });
    },
  };
}

const expectRefused = (outcome: ToolOutcome): RefusedOutcome => {
  if (outcome.status !== 'refused') {
    throw new Error(
      `expected refused, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 900)}`,
    );
  }
  return outcome;
};

/** The scores as the character was actually built, off the fold. */
const scoresOf = (t: Table): Record<string, number> =>
  t.campaign.state().creatures['brannor']!.sheet.abilities as unknown as Record<string, number>;

describe('the Ability Score Improvement through create_character', () => {
  it('puts two points into the one score the caller named', () => {
    const t = table('one-by-two');
    const outcome = t.create(cleric(improving(['wis', 'wis'])));
    expect(outcome.status).toBe('ok');

    // 15 assigned, 17 with the background's +2, 19 with the feat's 2.
    expect(scoresOf(t).wis).toBe(19);
    // And nothing else moved: the spread is the whole of what the feat did.
    expect(scoresOf(t)).toMatchObject({ str: 14, dex: 12, con: 14, int: 10, cha: 8 });
  });

  it('puts one point into each of the two scores the caller named', () => {
    const t = table('two-by-one');
    expect(t.create(cleric(improving(['wis', 'con']))).status).toBe('ok');

    expect(scoresOf(t).wis).toBe(18);
    expect(scoresOf(t).con).toBe(15);
  });

  /**
   * The three refusals, each by the name the engine gives it. They come from
   * `checkFeats` and nowhere else, which is what makes the schema's job here
   * the shape and only the shape.
   */
  it('refuses a spread the sentence does not print, by name', () => {
    const three = expectRefused(table('three-ones').create(cleric(improving(['wis', 'con', 'str']))));
    expect(three.code).toBe('ability_spread_not_offered');
    expect(three.reason).toContain('ability-score-improvement');
  });

  it('refuses a word that is not one of the six, by name', () => {
    const typo = expectRefused(table('typo').create(cleric(improving(['wisdom']))));
    expect(typo.code).toBe('unknown_ability');
    expect(typo.reason).toContain('wisdom');
  });

  it('refuses the feat with no scores named at all, by name', () => {
    const silent = expectRefused(table('silent').create(cleric(improving(undefined))));
    expect(silent.code).toBe('missing_ability_choice');
  });
});
