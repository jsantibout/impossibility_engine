/**
 * What a spell puts in a hand, reached through `surface.call` and nothing else.
 *
 * The engine holds the rule; this is the claim that a model can get at it. Two
 * printed sentences and three calls:
 *
 * - SRD Goodberry's berries are conjured by `cast_spell`, eaten by `use_item`,
 *   and shown as conjured on the sheet — because ten berries out of a spell and
 *   ten out of a pack are indistinguishable otherwise, and only one of the two
 *   disappears when the casting ends;
 * - SRD Flame Blade's "if you let go of the blade, it disappears" is
 *   `let_go_of_conjured`, and its "you can evoke the blade again as a Bonus
 *   Action" is `evoke_conjured`;
 * - a spell that prints no such clause is refused rather than granted one.
 *
 * This file imports no engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, type ToolOutcome } from '@ie/tools';

const DRUID: Record<string, unknown> = {
  name: 'Fenn',
  classId: 'druid',
  level: 5,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 13, con: 14, int: 8, wis: 15, cha: 12 },
  },
  abilityIncreases: { wis: 2, con: 1 },
  classSkills: ['nature', 'survival'],
  languages: ['Elvish', 'Dwarvish'],
  alignment: 'Neutral Good',
  subclassId: 'circle-of-the-land',
  cantrips: ['poison-spray', 'guidance', 'produce-flame'],
  spellbook: [],
  preparedSpells: [
    'goodberry',
    'flame-blade',
    'cure-wounds',
    'healing-word',
    'thunderwave',
    'hold-person',
    'faerie-fire',
    'entangle',
    'moonbeam',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'], 'druid:primal-order': ['Magician'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'druid:ability-score-improvement': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
};

function table(seed: string) {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });
  return { campaign, surface, call };
}

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome;
};

const expectRefused = (outcome: ToolOutcome) => {
  if (outcome.status !== 'refused') {
    throw new Error(
      `expected refused, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 900)}`,
    );
  }
  return outcome;
};

interface Line {
  readonly id: string;
  readonly quantity: number;
  readonly conjured?: string;
}

const party = (seed = 'berries') => {
  const t = table(seed);
  expectOk(t.call('create_character', { id: 'fenn', choices: DRUID }));
  return t;
};

const carrying = (t: ReturnType<typeof table>): readonly Line[] =>
  expectOk(t.call('sheet', { who: 'fenn' })).resolution['carrying'] as readonly Line[];

const lineOf = (t: ReturnType<typeof table>, item: string): Line | undefined =>
  carrying(t).find((line) => line.id === item);

describe('a model can conjure something into a hand and eat it', () => {
  it('shows the berries as this casting’s, and takes one back when it is eaten', () => {
    const t = party();
    expectOk(t.call('cast_spell', { caster: 'fenn', spellId: 'goodberry', targets: [], slotLevel: 1 }));

    const berries = lineOf(t, 'goodberry');
    expect(berries?.quantity).toBe(10);
    // The one fact a pack of berries could not have: which casting holds them.
    expect(berries?.conjured).toBe('cast:1');

    expectOk(t.call('use_item', { who: 'fenn', item: 'goodberry' }));
    expect(lineOf(t, 'goodberry')?.quantity).toBe(9);
  });

  /**
   * SRD prints the re-evocation on Flame Blade and nowhere else, so a handful
   * let go of is a handful gone.
   */
  it('lets go of them, and refuses to evoke back what the spell never offered', () => {
    const t = party('let-go');
    expectOk(t.call('cast_spell', { caster: 'fenn', spellId: 'goodberry', targets: [], slotLevel: 1 }));
    expectOk(t.call('let_go_of_conjured', { who: 'fenn', item: 'goodberry' }));
    expect(lineOf(t, 'goodberry')).toBeUndefined();

    const refused = expectRefused(t.call('evoke_conjured', { who: 'fenn', item: 'goodberry' }));
    expect(refused.status === 'refused' && refused.code).toBe('not_re_evoked');
  });
});

describe('Flame Blade’s two halves are two calls', () => {
  it('lets go of the blade and evokes it again, with the casting untouched', () => {
    const t = party('blade');
    expectOk(
      t.call('cast_spell', { caster: 'fenn', spellId: 'flame-blade', targets: [], slotLevel: 2 }),
    );
    expect(lineOf(t, 'flame-blade')?.conjured).toBe('cast:1');

    expectOk(t.call('let_go_of_conjured', { who: 'fenn', item: 'flame-blade' }));
    expect(lineOf(t, 'flame-blade')).toBeUndefined();
    // The spell is still running: it is the blade that went, not the casting.
    const held = expectOk(t.call('sheet', { who: 'fenn' })).resolution['concentratingOn'];
    expect(held).toBe('Flame Blade');

    expectOk(t.call('evoke_conjured', { who: 'fenn', item: 'flame-blade' }));
    expect(lineOf(t, 'flame-blade')?.conjured).toBe('cast:1');
  });

  /** And nothing a spell did not conjure answers either call. */
  it('refuses to let go of something nobody conjured', () => {
    const t = party('nothing');
    const refused = expectRefused(t.call('let_go_of_conjured', { who: 'fenn', item: 'quarterstaff' }));
    expect(refused.status === 'refused' && refused.code).toBe('not_conjured');
  });
});
