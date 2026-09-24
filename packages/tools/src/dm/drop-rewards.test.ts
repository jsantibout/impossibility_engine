/**
 * The falling chandelier pays the Warlock, at the DM's door.
 *
 * SRD Dark One's Blessing: "You also gain this benefit if someone else reduces
 * an enemy within 10 feet of you to 0 Hit Points." *Someone else* is not a
 * spell and not a swing — a goblin crushed by a chandelier somebody's ally
 * brought down is an enemy reduced to 0 Hit Points, and the sentence names no
 * instrument at all.
 *
 * The two improvised tools are the only doors in the engine that reach damage
 * without a spell, a weapon or a stat block behind it, which is what makes
 * them the test: `improvised_damage` hands `resolveDamage` an amount, and
 * `roll_improvised_damage` hands it dice. Both go through the one funnel, and
 * the funnel is where the watcher is paid.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createDmSurface, type ToolOutcome } from '@ie/tools';

/** A Warlock 3 of the Fiend with Charisma 16: the modifier is +3, the level is 3. */
const kael = (): Record<string, unknown> => ({
  name: 'Kael',
  classId: 'warlock',
  level: 3,
  speciesId: 'human',
  backgroundId: 'acolyte',
  abilities: {
    method: 'standard-array',
    assignment: { str: 13, dex: 14, con: 12, int: 10, wis: 8, cha: 15 },
  },
  abilityIncreases: { wis: 2, cha: 1 },
  classSkills: ['arcana', 'deception'],
  languages: ['Draconic', 'Goblin'],
  alignment: 'Neutral Evil',
  subclassId: 'fiend-patron',
  cantrips: ['eldritch-blast', 'chill-touch'],
  spellbook: [],
  preparedSpells: ['hex', 'charm-person', 'hold-person', 'mind-spike'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['leather-armor'],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'acolyte:magic-initiate-cleric': {
      featId: 'magic-initiate',
      spellList: 'cleric',
      spellcastingAbility: 'wis',
      cantrips: ['guidance', 'sacred-flame'],
      levelOneSpell: 'bless',
    },
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 700)}`);
  }
  return outcome;
};

/**
 * Kael, an ally with a crowbar, and a goblin five feet away on the other side.
 *
 * The scene is laid out because the second half of the sentence is a distance
 * — "within 10 feet of you" — and a distance is a question only a scene
 * answers.
 */
function table(seed: string, options: { readonly scene?: boolean } = {}) {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    return surface.call({ tool, input, commandId: `toolu_${calls}` });
  };

  expectOk(call('create_character', { id: 'kael', choices: kael() }));
  expectOk(call('add_creature', { id: 'rook', monsterId: 'commoner' }));
  expectOk(call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
  expectOk(call('declare_side', { who: 'kael', side: 'party' }));
  expectOk(call('declare_side', { who: 'rook', side: 'party' }));
  expectOk(call('declare_side', { who: 'grish', side: 'goblins' }));

  if (options.scene !== false) {
    expectOk(call('set_scene', { width: 60, depth: 40, height: 20 }));
    expectOk(call('add_landmark', { name: 'the chandelier', at: { x: 20, y: 20 } }));
    expectOk(call('place_creature', { who: 'kael', fromLandmark: 'the chandelier', feet: 0 }));
    expectOk(call('place_creature', { who: 'rook', fromCreature: 'kael', feet: 5, bearing: 0 }));
    expectOk(call('place_creature', { who: 'grish', fromCreature: 'kael', feet: 5, bearing: 90 }));
  }

  return { campaign, surface, call };
}

const temporaryHpOf = (t: ReturnType<typeof table>, who: string): number =>
  t.campaign.state().creatures[who as never]!.vitals.temporaryHp;

describe('a drop nobody rolled for still pays the watcher', () => {
  it('pays six Temporary Hit Points for an ally’s adjudicated blow', () => {
    const t = table('the-chandelier');
    const out = expectOk(
      t.call('improvised_damage', {
        target: 'grish',
        amount: 20,
        ruling: 'the chandelier came down on it',
        by: 'rook',
      }),
    );

    // Charisma 16 is +3 and the Warlock level is 3, and the DM stated neither.
    expect(
      out.events.filter((event) => event.type === 'temporary-hp-granted'),
    ).toEqual([
      { type: 'temporary-hp-granted', id: 'kael', amount: 6, source: "Dark One's Blessing" },
    ]);
    expect(temporaryHpOf(t, 'kael')).toBe(6);
    expect(out.unverified).toEqual([]);
  });

  /** And the other improvised door, where the engine throws the dice itself. */
  it('pays the same for dice the engine threw', () => {
    const t = table('the-brazier');
    const out = expectOk(
      t.call('roll_improvised_damage', {
        target: 'grish',
        dice: '10d6',
        damageType: 'fire',
        ruling: 'the brazier tipped over onto it',
        by: 'rook',
      }),
    );
    expect(temporaryHpOf(t, 'kael')).toBe(6);
    expect(out.unverified).toEqual([]);
  });

  /**
   * And with no scene laid out the second half of the sentence cannot be
   * measured, so nothing is paid and the door **says so** rather than guessing
   * either way.
   */
  it('pays nothing and says why where nobody has laid out a scene', () => {
    const t = table('no-room', { scene: false });
    const out = expectOk(
      t.call('improvised_damage', {
        target: 'grish',
        amount: 20,
        ruling: 'something heavy, somewhere',
        by: 'rook',
      }),
    );
    expect(temporaryHpOf(t, 'kael')).toBe(0);
    expect(out.unverified.join(' ')).toContain('nobody has laid out a scene');
    expect(out.unverified.join(' ')).toContain("Dark One's Blessing");
  });

  /**
   * And the dice door says it too, which it could not before: it reported
   * nothing at all, so a DM rolling 10d6 for the brazier was told the same
   * thing whether the Warlock had been paid or not.
   */
  it('says the same at the door that throws the dice', () => {
    const t = table('no-room-either', { scene: false });
    const out = expectOk(
      t.call('roll_improvised_damage', {
        target: 'grish',
        dice: '10d6',
        damageType: 'fire',
        ruling: 'a brazier, somewhere',
        by: 'rook',
      }),
    );
    expect(temporaryHpOf(t, 'kael')).toBe(0);
    expect(out.unverified.join(' ')).toContain('nobody has laid out a scene');
    expect(out.unverified.join(' ')).toContain("Dark One's Blessing");
  });
});
