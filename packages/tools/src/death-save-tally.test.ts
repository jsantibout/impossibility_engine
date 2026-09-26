/**
 * The death-save tally, read through `look` and `sheet` (W8-T3).
 *
 * SRD: "Whenever you start your turn with 0 Hit Points, you must make a Death
 * Saving Throw ... On your third success, you become Stable. On your third
 * failure, you die." The engine keeps the count on the creature's vitals, and
 * `death-save-recorded` carries only the die — so a table that wanted to show
 * "two successes, one failure" had to count faces itself, which is a second
 * implementation of the rule sitting in an app. `observe()` now reads the
 * count off state, beside `hp`, `stable` and `dead`, as `deathSaves`.
 *
 * **The counts are shown while they run, and the outcome after.** Stable
 * resets both of the engine's numbers and death leaves the successes where
 * they stood, so a Stable or dead creature reports its outcome alone rather
 * than a "two successes" beside a corpse.
 *
 * This file imports no engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createDmSurface, createSurface, type ToolOutcome } from '@ie/tools';

const fighter = (name: string): Record<string, unknown> => ({
  name,
  classId: 'fighter',
  level: 1,
  speciesId: 'dwarf',
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
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome;
};

type Tally =
  | { readonly outcome: 'dying'; readonly successes: number; readonly failures: number }
  | { readonly outcome: 'stable' }
  | { readonly outcome: 'dead' };

/** Bram on the floor at nought, Orin beside him, and a fight running. */
function down(seed: string) {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  const dm = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });
  const rule = (tool: string, input: unknown = {}): ToolOutcome =>
    dm.call({ tool, input, commandId: `dm_${(calls += 1)}` });

  expectOk(call('create_character', { id: 'bram', choices: fighter('Bram') }));
  expectOk(call('create_character', { id: 'orin', choices: fighter('Orin') }));
  expectOk(call('roll_initiative', { combatants: [{ who: 'bram' }, { who: 'orin' }] }));

  const seen = () => surface.observe().creatures.find((one) => one.id === 'bram')!;
  const sheet = () => expectOk(call('sheet', { who: 'bram' })).resolution;

  expect(seen().deathSaves, 'a creature with hit points has no tally').toBeNull();
  expect(sheet()['deathSaves']).toBeNull();
  // Exactly what he has left: a blow of the maximum over again is instant
  // death, and this file is about the creature that is still dying.
  expectOk(
    rule('improvised_damage', { target: 'bram', amount: seen().hp, ruling: 'the portcullis' }),
  );
  expect(seen().hp).toBe(0);
  expect(seen().deathSaves).toEqual({ outcome: 'dying', successes: 0, failures: 0 });
  expect(sheet()['deathSaves']).toEqual({ outcome: 'dying', successes: 0, failures: 0 });

  return { campaign, call, rule, seen, sheet };
}

/**
 * The SRD's sentence, as the test's oracle for the face the engine threw. It
 * reads the face off the log; it never supplies one.
 */
function next(
  before: Extract<Tally, { outcome: 'dying' }>,
  natural: number,
  total: number,
): Tally | 'revived' {
  if (natural === 20) return 'revived';
  if (natural === 1 || total < 10) {
    const failures = before.failures + (natural === 1 ? 2 : 1);
    return failures >= 3 ? { outcome: 'dead' } : { ...before, failures };
  }
  const successes = before.successes + 1;
  return successes >= 3 ? { outcome: 'stable' } : { ...before, successes };
}

describe('the death-save tally on look and sheet', () => {
  // Three seeds, which between them end Stable and dead: which is which is the
  // engine's to roll, so no case below assumes either.
  it.each(['plaque-1', 'plaque-2', 'plaque-3'])(
    'shows the tally after every save, then how it ended (seed %s)',
    (seed) => {
      const t = down(seed);
      let tally: Tally = { outcome: 'dying', successes: 0, failures: 0 };
      let saves = 0;
      let revived = false;
      // At most five saves settle it, and two turns pass per round.
      for (let turn = 0; turn < 12 && tally.outcome === 'dying' && !revived; turn += 1) {
        const ended = expectOk(t.call('end_turn'));
        const save = ended.events.find(
          (event) => event.type === 'death-save-recorded' && event.id === 'bram',
        ) as { natural: number; total?: number } | undefined;
        if (save === undefined || tally.outcome !== 'dying') continue;
        saves += 1;

        const then = next(tally, save.natural, save.total ?? save.natural);
        if (then === 'revived') {
          revived = true;
          expect(t.seen().hp).toBe(1);
          expect(t.seen().deathSaves).toBeNull();
          continue;
        }
        tally = then;
        expect(t.seen().deathSaves, `after save ${saves}`).toEqual(tally);
        expect(t.sheet()['deathSaves'], `after save ${saves}, on the sheet`).toEqual(tally);
        expect(t.seen().stable).toBe(tally.outcome === 'stable');
        expect(t.seen().dead).toBe(tally.outcome === 'dead');
      }
      expect(saves, 'the turn boundary rolled the saves').toBeGreaterThan(0);
      expect(revived || tally.outcome !== 'dying', 'and it ended').toBe(true);
    },
  );

  /** No die in it: damage at nought costs a failure, and three kill. */
  it('counts the failures damage costs, then reads dead', () => {
    const t = down('failures');
    const hit = () =>
      expectOk(t.rule('improvised_damage', { target: 'bram', amount: 1, ruling: 'a kick' }));
    hit();
    expect(t.seen().deathSaves).toEqual({ outcome: 'dying', successes: 0, failures: 1 });
    hit();
    expect(t.seen().deathSaves).toEqual({ outcome: 'dying', successes: 0, failures: 2 });
    hit();
    expect(t.seen().deathSaves).toEqual({ outcome: 'dead' });
    expect(t.sheet()['deathSaves']).toEqual({ outcome: 'dead' });
  });

  it('reads stable once somebody stabilises the creature', () => {
    const t = down('stable');
    expectOk(t.rule('improvised_damage', { target: 'bram', amount: 1, ruling: 'a kick' }));
    expectOk(t.call('stabilise_creature', { who: 'bram' }));
    expect(t.seen().deathSaves).toEqual({ outcome: 'stable' });
  });
});
