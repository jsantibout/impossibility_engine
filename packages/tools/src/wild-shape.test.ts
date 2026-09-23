/**
 * SRD Wild Shape through the player's door.
 *
 * The engine test (`packages/engine/src/wild-shape.test.ts`) proves the
 * mechanism; this file proves a caller can *find* it and *use* it with no
 * number of its own: the sheet lists the feature as spendable and names the
 * tool that spends it and the forms the character learned, `assume_shape`
 * takes one and the sheet says which is worn, `revert_shape` leaves it, and
 * the two refusals a caller can walk into come back as values with the
 * learned forms named in the reason.
 *
 * This file imports no engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, type ToolOutcome } from '@ie/tools';

/** The engine test's level 5 Druid, as the transport would send it. */
const druid = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'Fenn',
  classId: 'druid',
  level: 5,
  subclassId: 'circle-of-the-land',
  speciesId: 'human',
  backgroundId: 'acolyte',
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 14, con: 13, int: 8, wis: 15, cha: 12 },
  },
  abilityIncreases: { wis: 2, cha: 1 },
  classSkills: ['nature', 'perception'],
  languages: ['Elvish', 'Dwarvish'],
  alignment: 'Neutral',
  cantrips: ['druidcraft', 'guidance', 'shillelagh'],
  spellbook: [],
  preparedSpells: [
    'aid',
    'barkskin',
    'call-lightning',
    'cure-wounds',
    'dispel-magic',
    'faerie-fire',
    'fog-cloud',
    'goodberry',
    'healing-word',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['leather-armor'],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['acrobatics'],
    'druid:primal-order': ['Magician'],
  },
  feats: {
    'acolyte:magic-initiate-cleric': {
      featId: 'magic-initiate',
      spellList: 'cleric',
      spellcastingAbility: 'wis',
      cantrips: ['guidance', 'sacred-flame'],
      levelOneSpell: 'bless',
    },
    'human:versatile': { featId: 'alert' },
    'druid:ability-score-improvement': {
      featId: 'ability-score-improvement',
      abilities: ['wis', 'wis'],
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
  knownForms: ['wolf', 'rat', 'spider', 'riding-horse'],
  ...over,
});

function table(seed = 'a-wolf-in-the-glade') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    return surface.call({ tool, input, commandId: `toolu_${calls}` });
  };
  return { call };
}

type Table = ReturnType<typeof table>;

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 800)}`,
    );
  }
  return outcome;
};

const expectRefused = (outcome: ToolOutcome, code: string) => {
  if (outcome.status !== 'refused') {
    throw new Error(
      `expected refused/${code}, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 800)}`,
    );
  }
  expect(outcome.code).toBe(code);
  return outcome;
};

interface HeldLine {
  readonly feature: string;
  readonly kind: string;
  readonly spentBy: string | null;
  readonly active: boolean;
  readonly left: number | null;
  readonly lasts?: string;
  readonly forms?: readonly string[];
  readonly form?: string | null;
  readonly maxChallengeRating?: number;
  readonly flying?: boolean;
}

const wildShapeLine = (t: Table): HeldLine | undefined =>
  (expectOk(t.call('sheet', { who: 'fenn' })).resolution['features'] as readonly HeldLine[]).find(
    (line) => line.feature === 'druid:wild-shape',
  );

describe('Wild Shape through the door', () => {
  it('lists the feature as spendable by assume_shape, with the forms the character learned', () => {
    const t = table();
    expectOk(t.call('create_character', { id: 'fenn', choices: druid() }));
    expect(wildShapeLine(t)).toMatchObject({
      kind: 'shape',
      spentBy: 'assume_shape',
      active: false,
      left: 2,
      lasts: '2 hours',
      forms: ['rat', 'riding-horse', 'spider', 'wolf'],
      form: null,
      maxChallengeRating: 0.5,
      flying: false,
    });
  });

  it('takes a form, says which is worn, and leaves it again', () => {
    const t = table();
    expectOk(t.call('create_character', { id: 'fenn', choices: druid() }));

    const taken = expectOk(
      t.call('assume_shape', { who: 'fenn', feature: 'druid:wild-shape', form: 'wolf' }),
    );
    expect(taken.resolution).toMatchObject({ assumed: 'wolf', feature: 'druid:wild-shape' });
    expect(taken.events.map((event) => event.type)).toEqual([
      'resource-spent',
      'feature-activated',
      'shape-assumed',
      'temporary-hp-granted',
      'effect-scheduled',
    ]);
    expect(wildShapeLine(t)).toMatchObject({ active: true, form: 'wolf', left: 1 });

    const left = expectOk(t.call('revert_shape', { who: 'fenn' }));
    expect(left.events.map((event) => event.type)).toEqual(['feature-ended']);
    expect(wildShapeLine(t)).toMatchObject({ active: false, form: null, left: 1 });
  });

  it('refuses a form the character has not learned, and names the ones it has', () => {
    const t = table();
    expectOk(t.call('create_character', { id: 'fenn', choices: druid() }));
    const refused = expectRefused(
      t.call('assume_shape', { who: 'fenn', feature: 'druid:wild-shape', form: 'boar' }),
      'form_not_known',
    );
    expect(refused.reason).toContain('rat, riding-horse, spider, wolf');
    expectRefused(t.call('revert_shape', { who: 'fenn' }), 'not_shaped');
  });

  it('refuses a character made with a form its level does not allow', () => {
    const t = table();
    // A Brown Bear is CR 1; a Druid 5 may learn forms of CR 1/2 and below.
    expectRefused(
      t.call('create_character', { id: 'fenn', choices: druid({ knownForms: ['brown-bear'] }) }),
      'form_not_eligible',
    );
  });
});
