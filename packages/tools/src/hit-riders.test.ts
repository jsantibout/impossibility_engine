/**
 * What a blow buys, asked for through the door.
 *
 * `AttackCommand.onHit` is the engine's trigger for a feature whose effect
 * list is bought by a hit — SRD Stunning Strike: "Once per turn when you hit a
 * creature with a Monk weapon or an Unarmed Strike, you can expend 1 Focus
 * Point to attempt a stunning strike." The engine has executed it since
 * `commands/hit-riders.ts` landed and nothing above the engine carried the
 * field, so a Monk could swing all day and never elect one, and the four
 * refusals the engine writes about a rider — a feature the character has not
 * got, an option it does not offer, a weapon the sentence does not cover, a
 * pool with nothing left in it — were unreachable rather than unanswerable.
 *
 * **No number the caller produced.** The whole of the field is two ids: which
 * feature, and which of the things it offers. The save DC, the ability, the
 * die, the condition and the deadline are all the engine's, derived at the
 * moment of the hit from the holder's own sheet.
 *
 * **And the report beside it.** SRD writes every one of these as "you can", so
 * a rider is elected or it does not happen — and a caller that has not been
 * told it holds one cannot elect it. `sheet` reports the feature, the menu and
 * `spentBy: 'attack'`, which is the half-a-door rule `SPENT_BY` exists for. It
 * reports the *clause* too, and that is the one addition worth arguing for: the
 * feature id, the option id and what is left of the pool make three of the four
 * refusals foreseeable, and "with a Monk weapon or an Unarmed Strike" is the
 * fourth. A caller shown the option and not the sentence swings a longsword.
 *
 * This file imports no engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  createCampaign,
  createDmSurface,
  createSurface,
  type ToolOutcome,
} from '@ie/tools';

/**
 * A Monk at the level Stunning Strike arrives, holding the spear its own
 * starting package gives it.
 *
 * Five, because that is where SRD grants the feature. The spear is a Simple
 * melee weapon and therefore a Monk weapon, which is the clause the engine
 * checks before it rolls anything — and it comes out of the class's own
 * equipment option rather than through the DM's door, so nothing has to be
 * handed out for the swing to be legal.
 */
const monk = (name: string): Record<string, unknown> => ({
  name,
  classId: 'monk',
  level: 5,
  subclassId: 'warrior-of-the-open-hand',
  speciesId: 'dwarf',
  backgroundId: 'criminal',
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 15, con: 13, int: 8, wis: 14, cha: 12 },
  },
  abilityIncreases: { con: 2, dex: 1 },
  classSkills: ['acrobatics', 'stealth'],
  languages: ['Dwarvish', 'Goblin'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {},
  feats: {
    'criminal:alert': { featId: 'alert' },
    // Wisdom, because the DC this feature prints is read off it: SRD Monk's
    // Focus is "8 plus your Wisdom modifier and Proficiency Bonus".
    'monk:ability-score-improvement': { featId: 'ability-score-improvement', abilities: ['wis', 'wis'] },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

function table(seed: string) {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  const dm = createDmSurface(campaign);
  let calls = 0;

  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });

  /** The DM's door, over the same campaign, for the one thing a model may not do. */
  const rule = (tool: string, input: unknown = {}): ToolOutcome =>
    dm.call({ tool, input, commandId: `dm_${(calls += 1)}` });

  return { campaign, surface, call, rule };
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
      `expected refused, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome;
};

/**
 * A Monk, a goblin five feet away, and a fight already running.
 *
 * In combat, because the deadline this rider files is a moment in the turn
 * order — "until the start of your next turn" — and the engine refuses one the
 * clock cannot reach. The turn is wound forward to the Monk's rather than
 * assumed: Initiative is the engine's die and which way it fell is not this
 * file's business.
 */
function fight(seed: string) {
  const t = table(seed);
  expectOk(t.call('create_character', { id: 'suri', choices: monk('Suri') }));
  expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
  expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the well', at: { x: 10, y: 10 } }));
  expectOk(t.call('place_creature', { who: 'suri', fromLandmark: 'the well', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'grish', fromCreature: 'suri', feet: 5, bearing: 90 }));
  expectOk(t.call('roll_initiative', { combatants: [{ who: 'suri' }, { who: 'grish' }] }));
  for (let guard = 0; guard < 4 && t.surface.observe().turnOf !== 'suri'; guard += 1) {
    expectOk(t.call('end_turn', {}));
  }
  expect(t.surface.observe().turnOf).toBe('suri');
  return t;
}

const conditionsOn = (t: ReturnType<typeof table>, who: string): readonly string[] =>
  t.surface.observe().creatures.find((one) => one.id === who)!.conditions;

const focusLeft = (t: ReturnType<typeof table>, who: string): number => {
  const held = expectOk(t.call('sheet', { who })).resolution as Record<string, unknown>;
  const pools = held['pools'] as readonly { readonly key: string; readonly left: number }[];
  return pools.find((one) => one.key === 'focus-points')!.left;
};

const STUN = { feature: 'monk:stunning-strike', option: 'stun' };

describe('a hit rider is elected by the swing that buys it', () => {
  it('spends the Focus Point and stuns the creature the blow landed on', () => {
    const t = fight('stun-0');
    const before = focusLeft(t, 'suri');

    const swing = expectOk(
      t.call('attack', { attacker: 'suri', target: 'grish', weapon: 'spear', onHit: STUN }),
    );
    expect(swing.resolution['hit']).toBe(true);

    // The point is spent by the engine, out of a pool the feature does not
    // own — SRD charges Stunning Strike against Monk's Focus.
    expect(swing.events.some((event) => event.type === 'resource-spent')).toBe(true);
    expect(focusLeft(t, 'suri')).toBe(before - 1);
    expect(conditionsOn(t, 'grish')).toContain('stunned');
  });

  it('buys nothing at all when the swing asks for nothing', () => {
    const t = fight('stun-0');
    const before = focusLeft(t, 'suri');

    expectOk(t.call('attack', { attacker: 'suri', target: 'grish', weapon: 'spear' }));

    expect(focusLeft(t, 'suri')).toBe(before);
    expect(conditionsOn(t, 'grish')).not.toContain('stunned');
  });

  /**
   * And the two refusals arrive **before** the swing, which is what the engine
   * asks the question early for: a rider it cannot buy costs the Monk neither
   * its action nor its point.
   */
  it('refuses an option the feature does not offer, and spends nothing', () => {
    const t = fight('stun-0');
    const before = focusLeft(t, 'suri');

    const refused = expectRefused(
      t.call('attack', {
        attacker: 'suri',
        target: 'grish',
        weapon: 'spear',
        onHit: { feature: 'monk:stunning-strike', option: 'decapitate' },
      }),
    );
    expect(refused.code).toBe('no_such_option');
    expect(refused.reason).toContain('stun');

    expect(focusLeft(t, 'suri')).toBe(before);
    expect(t.surface.observe().creatures.find((one) => one.id === 'grish')!.hp).toBe(
      t.surface.observe().creatures.find((one) => one.id === 'grish')!.hpMax,
    );
  });

  it('refuses a feature the swinger has not got, naming it', () => {
    const t = fight('stun-0');
    const refused = expectRefused(
      t.call('attack', {
        attacker: 'suri',
        target: 'grish',
        weapon: 'spear',
        onHit: { feature: 'monk:quivering-palm', option: 'stun' },
      }),
    );
    expect(refused.code).toBe('no_such_feature');
    expect(refused.reason).toContain('monk:quivering-palm');
  });

  /**
   * A fact that is merely missing is homework and not a verdict, which is the
   * rule this whole surface keeps: a swing at somebody nobody has created is
   * answered with what would settle it.
   */
  it('asks rather than refuses when the creature swung at does not exist yet', () => {
    const t = fight('stun-0');
    const outcome = t.call('attack', {
      attacker: 'suri',
      target: 'nobody',
      weapon: 'spear',
      onHit: STUN,
    });
    expect(outcome.status).toBe('needs-context');
  });
});

describe('a caller can see the rider it is asked to elect', () => {
  it('reports the feature, the menu and the tool that spends one', () => {
    const t = table('sheet');
    expectOk(t.call('create_character', { id: 'suri', choices: monk('Suri') }));
    const held = expectOk(t.call('sheet', { who: 'suri' })).resolution as Record<string, unknown>;
    const features = held['features'] as readonly Record<string, unknown>[];
    const found = features.find((one) => one['feature'] === 'monk:stunning-strike');

    expect(found).toMatchObject({
      name: 'Stunning Strike',
      kind: 'hit-rider',
      spentBy: 'attack',
      pool: 'focus-points',
      onHit: [{ option: 'stun', name: 'Stunning Strike', oncePerTurn: true }],
    });
  });

  /**
   * And the clause, which is the one refusal of the four a caller could not
   * otherwise see coming.
   *
   * The feature id, the option id and what is left of the pool are all on the
   * line already, so `no_such_feature`, `no_such_option` and `exhausted` are
   * each foreseeable from the report. `weapon_not_covered` was not: SRD
   * Stunning Strike rides on "a Monk weapon or an Unarmed Strike", and a caller
   * shown the option and not the sentence elects it with a longsword.
   */
  it('says which weapons the feature’s own sentence covers, and that a fist counts', () => {
    const t = table('sheet');
    expectOk(t.call('create_character', { id: 'suri', choices: monk('Suri') }));
    const held = expectOk(t.call('sheet', { who: 'suri' })).resolution as Record<string, unknown>;
    const features = held['features'] as readonly Record<string, unknown>[];
    const found = features.find((one) => one['feature'] === 'monk:stunning-strike')!;
    const onHit = found['onHit'] as readonly Record<string, unknown>[];

    expect(onHit[0]!['unarmedStrike']).toBe(true);
    expect(onHit[0]!['weapons']).toEqual([
      { category: 'simple', kind: 'melee' },
      { category: 'martial', kind: 'melee', properties: ['light'] },
    ]);
  });

  /**
   * The refusal the clause foresees, arriving as the report said it would — and
   * costing nothing, because the engine asks before it rolls.
   */
  it('refuses a swing the sentence does not cover, naming what it wanted', () => {
    const t = fight('stun-0');
    const before = focusLeft(t, 'suri');
    // Through the DM's door, because handing out what a party found is the
    // DM's call — and a Monk's own package holds nothing this clause excludes.
    expectOk(
      t.rule('award_items', {
        who: 'suri',
        items: [{ id: 'greataxe' }],
        because: 'taken off the dead orc',
      }),
    );

    const refused = expectRefused(
      t.call('attack', { attacker: 'suri', target: 'grish', weapon: 'greataxe', onHit: STUN }),
    );
    expect(refused.code).toBe('weapon_not_covered');
    expect(focusLeft(t, 'suri')).toBe(before);
  });
});
