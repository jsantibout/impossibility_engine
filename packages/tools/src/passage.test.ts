/**
 * SRD Halfling Nimbleness on the sheet the door publishes.
 *
 * > "You can move through the space of any creature that is a size larger
 * > than you, but you can't stop in the same space."
 *
 * The rule is the engine's — `commands/movement.ts` reads the spaces a move
 * states and `canPassThrough` says which of them this creature may enter —
 * and the only thing the surface owes it is a **line**. `reachability.test.ts`
 * classifies a feature by what the sheet says about it, and a standing grant
 * nobody elects and nobody pays for is *passive*: `kind: 'passive'` and
 * `spentBy: null`, which is precisely what `reachOf` reads before it looks at
 * the grant at all. So this is the claim that the trait is reachable: there
 * is nothing to reach, and the sheet says so rather than leaving a room with
 * no door.
 *
 * It imports no engine, for `holdings.test.ts`'s reason: `@ie/content` for the
 * book and `@ie/tools` for the door.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, type ToolOutcome } from '@ie/tools';

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome;
};

/** A Halfling Fighter at the level every Halfling trait arrives at. */
const halfling = (name: string): Record<string, unknown> => ({
  name,
  classId: 'fighter',
  level: 1,
  speciesId: 'halfling',
  backgroundId: 'criminal',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  },
  abilityIncreases: { con: 2, dex: 1 },
  classSkills: ['athletics', 'perception'],
  languages: ['Dwarvish', 'Goblin'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'fighter:weapon-mastery': ['longsword', 'handaxe', 'javelin'] },
  feats: { 'criminal:alert': { featId: 'alert' }, 'fighter:fighting-style': { featId: 'defense' } },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

interface HeldFeature {
  readonly feature: string;
  readonly kind: string;
  readonly spentBy: string | null;
}

describe('the sheet reports Halfling Nimbleness as a benefit nobody spends', () => {
  const sheetOf = (who: string) => {
    const surface = createSurface(createCampaign({ content: SRD_CONTENT, seed: 'nimble' }));
    let calls = 0;
    const call = (tool: string, input: unknown): ToolOutcome =>
      surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });
    expectOk(call('create_character', { id: who, choices: halfling(who) }));
    return expectOk(call('sheet', { who })).resolution['features'] as readonly HeldFeature[];
  };

  it('publishes it as passive, which is how `reachOf` classifies it', () => {
    const line = sheetOf('rosie').find((one) => one.feature === 'halfling:halfling-nimbleness');
    expect(line).toBeDefined();
    expect(line!.kind).toBe('passive');
    expect(line!.spentBy).toBeNull();
  });

  /**
   * Non-vacuity, in the way this test could quietly stop measuring: a sheet
   * that reported every feature the same way would pass the assertion above
   * and mean nothing. The same Halfling holds a line that *is* spendable.
   */
  it('reports something spendable beside it', () => {
    const lines = sheetOf('rosie-two');
    expect(lines.some((one) => one.spentBy !== null)).toBe(true);
  });
});
