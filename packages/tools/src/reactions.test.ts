/**
 * The moments a creature may answer, driven through `surface.call` and
 * nothing else.
 *
 * **This file imports no engine.** A window a caller can be *told* about and
 * cannot answer is worse than one it is never told about: `options` has
 * reported the offers since `reactionOpportunities` landed, so a model could
 * read that a Shield was available, try every field it had, and be refused by
 * all of them. Three windows are opened here and answered here — a hit that is
 * held, a damage roll that has not landed, and a D20 Test whose effects have
 * not occurred — and each of them is closed, because a window nothing closes
 * wedges the fight it was opened in.
 *
 * `hold` is what makes the first one reachable at all. `pendingAttack` is
 * opened by an attacker asking for it and by nothing else, so until `attack`
 * carried the field, SRD *Shield* — prepared, paid for, and refused with
 * `no_trigger` every time — could not be cast from the only surface that
 * exists to cast spells.
 *
 * The D20 Test window is opened from the **DM's** surface, because the engine
 * opens one only for a check or a save somebody set a DC for, and a DC is a
 * number a model may not send. Two surfaces over one campaign are one
 * campaign, which is the arrangement `holdings.test.ts` already relies on.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  createCampaign,
  createDmSurface,
  createSurface,
  type ToolOutcome,
} from '@ie/tools';

// — the characters, each the smallest one that holds the feature ——————————

const BOOK = [
  'magic-missile',
  'shield',
  'detect-magic',
  'feather-fall',
  'mage-armor',
  'sleep',
  'thunderwave',
  'hold-person',
  'misty-step',
  'web',
];

/** A wizard with *Shield* prepared — `fight.test.ts`'s, at the same level. */
const wizard = (name: string): Record<string, unknown> => ({
  name,
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
  spellbook: BOOK.map((spellId, index) => ({
    spellId,
    acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
    origin: 'level' as const,
  })),
  preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'hold-person', 'burning-hands', 'scorching-ray'],
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
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

/**
 * A dwarf of a martial class, with no choice this file is not about.
 *
 * Dwarf and Criminal between them ask for nothing: the species grants four
 * traits and no choice, and the background's feat is Alert, which takes no
 * arguments of its own. What is left is the class's own, written per class.
 */
const martial = (
  classId: string,
  level: number,
  name: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  name,
  classId,
  level,
  speciesId: 'dwarf',
  backgroundId: 'criminal',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  },
  // Criminal offers Dexterity, Constitution and Intelligence.
  abilityIncreases: { dex: 2, con: 1 },
  languages: ['Dwarvish', 'Goblin'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  feats: { 'criminal:alert': { featId: 'alert' } },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
  ...extra,
});

/** SRD Tactical Mind is a Fighter 2 feature, and it answers a D20 Test. */
const fighter = () =>
  martial('fighter', 2, 'Bram', {
    classSkills: ['athletics', 'perception'],
    featureChoices: { 'fighter:weapon-mastery': ['longsword', 'handaxe', 'javelin'] },
    feats: {
      'criminal:alert': { featId: 'alert' },
      'fighter:fighting-style': { featId: 'defense' },
    },
  });

/** SRD Uncanny Dodge is a Rogue 5 feature, and it answers a damage roll. */
const rogue = () =>
  martial('rogue', 5, 'Nix', {
    subclassId: 'thief',
    classSkills: ['acrobatics', 'perception', 'investigation', 'athletics'],
    featureChoices: {
      'rogue:expertise': ['acrobatics', 'perception'],
      'rogue:weapon-mastery': ['dagger', 'shortsword'],
    },
    feats: {
      'criminal:alert': { featId: 'alert' },
      'rogue:ability-score-improvement': {
        featId: 'ability-score-improvement',
        abilities: ['dex', 'dex'],
      },
    },
  });

// — a table, with both doors over one campaign ——————————————————————————————

function table(seed: string) {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  const dm = createDmSurface(campaign);
  let calls = 0;

  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });

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

/** What is left of one of a character's pools, off `sheet`. */
const poolLeft = (t: ReturnType<typeof table>, who: string, key: string): number => {
  const pools = expectOk(t.call('sheet', { who })).resolution['pools'] as readonly {
    readonly key: string;
    readonly left: number;
  }[];
  return pools.find((one) => one.key === key)!.left;
};

const hpOf = (t: ReturnType<typeof table>, who: string): number =>
  t.surface.observe().creatures.find((one) => one.id === who)!.hp;

/** Which Reactions this creature is offered right now, by feature or spell id. */
const offered = (t: ReturnType<typeof table>, who: string) => {
  const outcome = expectOk(t.call('options', { who }));
  return outcome.resolution['reactions'] as readonly {
    readonly id: string;
    readonly window: string;
    readonly costsReaction: boolean;
  }[];
};

/**
 * End turns until it is this creature's, whichever way Initiative fell.
 *
 * The order is the engine's and the die is the engine's, so a test that wants
 * a particular creature to swing waits for it rather than arranging it.
 */
function turnOf(t: ReturnType<typeof table>, who: string) {
  for (let guard = 0; guard < 8; guard += 1) {
    const now = t.surface.observe().turnOf;
    if (now === who) return;
    expectOk(t.call('end_turn', { who: now! }));
  }
  throw new Error(`${who} never got a turn`);
}

/** A room with two creatures in it, five feet apart and in sight of each other. */
function room(t: ReturnType<typeof table>, a: string, b: string) {
  expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the bar', at: { x: 10, y: 10 } }));
  expectOk(t.call('place_creature', { who: a, fromLandmark: 'the bar', feet: 0 }));
  expectOk(t.call('place_creature', { who: b, fromCreature: a, feet: 5, bearing: 0 }));
  expectOk(t.call('declare_sight', { from: a, to: b, seen: true }));
  expectOk(t.call('declare_sight', { from: b, to: a, seen: true }));
}

// — the held hit, and the spell that answers it ————————————————————————————

describe('a wizard can cast Shield at the blow that is falling', () => {
  /**
   * An ogre rather than a goblin, because the window has to open on a *hit*
   * and a bigger attack bonus makes fewer seeds a coin toss. The hold is asked
   * for by the attacker before it swings: SRD gives the target the moment, and
   * nothing but `hold` creates it.
   */
  const tavern = (seed: string) => {
    const t = table(seed);
    expectOk(t.call('create_character', { id: 'kessa', choices: wizard('Kessa') }));
    expectOk(t.call('add_creature', { id: 'brute', monsterId: 'ogre' }));
    expectOk(t.call('declare_side', { who: 'kessa', side: 'party' }));
    expectOk(t.call('declare_side', { who: 'brute', side: 'rivals' }));
    room(t, 'kessa', 'brute');
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'brute' }, { who: 'kessa' }] }));
    turnOf(t, 'brute');
    return t;
  };

  /** A hit that is held, offered, answered, and turned aside. */
  it('opens the window, reports it, and the +5 turns the hit into a miss', () => {
    const t = tavern('deflected');
    const swing = expectOk(
      t.call('attack', { attacker: 'brute', target: 'kessa', weapon: 'greatclub', hold: true }),
    );
    expect(swing.resolution['hit']).toBe(true);
    // Held: the damage has not been rolled, so nothing has moved.
    expect(swing.events.some((event) => event.type === 'damage-taken')).toBe(false);
    const whole = hpOf(t, 'kessa');

    const chances = offered(t, 'kessa');
    expect(chances.map((one) => one.id)).toContain('shield');
    expect(chances.find((one) => one.id === 'shield')).toMatchObject({
      window: 'hit-by-attack',
      costsReaction: true,
    });

    expectOk(t.call('cast_spell', { caster: 'kessa', spellId: 'shield', targets: ['kessa'], slotLevel: 1 }));

    // SRD Shield: "+5 bonus to AC, including against the triggering attack."
    // The hit was re-measured against the raised number, and the blow that was
    // waiting is gone with no damage at all.
    expect(hpOf(t, 'kessa')).toBe(whole);
    expect(offered(t, 'kessa').map((one) => one.id)).not.toContain('shield');
    // And the turn can move on, which it could not while a hit was held.
    expectOk(t.call('end_turn', { who: 'brute' }));
  });

  /**
   * And the other half: a hold nobody answers is the attacker's to settle, and
   * until `settle_attack` existed a held attack was a debt no tool could pay —
   * `end_turn` refuses while one is open.
   */
  it('settles a held hit the target did not answer, and the damage lands then', () => {
    const t = tavern('unanswered');
    expectOk(t.call('attack', { attacker: 'brute', target: 'kessa', weapon: 'greatclub', hold: true }));
    const whole = hpOf(t, 'kessa');

    const settled = expectOk(t.call('settle_attack', { attacker: 'brute' }));
    expect(settled.events.some((event) => event.type === 'damage-taken')).toBe(true);
    expect(hpOf(t, 'kessa')).toBeLessThan(whole);
    expectOk(t.call('end_turn', { who: 'brute' }));
  });

  /** A refusal a caller can act on: there is no hit of yours to settle. */
  it('refuses a settlement of a hit nobody is holding, and spends nothing', () => {
    const t = tavern('nothing-held');
    const before = { log: t.campaign.log().length, rolls: t.campaign.state().rollsIssued };

    const refusal = expectRefused(t.call('settle_attack', { attacker: 'brute' }));
    expect(refusal.code).toBe('no_pending_attack');
    expect(t.campaign.log()).toHaveLength(before.log);
    expect(t.campaign.state().rollsIssued).toBe(before.rolls);
  });

  /**
   * A Shield cast with no blow in the air is refused by the trigger rule, and
   * the slot is still there afterwards — which is what makes the offer worth
   * reading rather than guessing.
   */
  it('refuses the Reaction when its moment has not arrived, and keeps the slot', () => {
    const t = tavern('no-trigger');
    expect(offered(t, 'kessa').map((one) => one.id)).not.toContain('shield');

    const refusal = expectRefused(
      t.call('cast_spell', { caster: 'kessa', spellId: 'shield', targets: ['kessa'], slotLevel: 1 }),
    );
    expect(refusal.code).toBe('no_trigger');
    const held = expectOk(t.call('sheet', { who: 'kessa' })).resolution['spellSlots'] as readonly {
      readonly level: number;
      readonly left: number;
    }[];
    expect(held.find((one) => one.level === 1)!.left).toBe(4);
  });
});

// — the damage roll that has not landed ————————————————————————————————————

describe('a Rogue can halve the blow that has been rolled', () => {
  const alley = (seed: string) => {
    const t = table(seed);
    expectOk(t.call('create_character', { id: 'nix', choices: rogue() }));
    expectOk(t.call('add_creature', { id: 'brute', monsterId: 'ogre' }));
    expectOk(t.call('declare_side', { who: 'nix', side: 'party' }));
    expectOk(t.call('declare_side', { who: 'brute', side: 'rivals' }));
    room(t, 'nix', 'brute');
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'brute' }, { who: 'nix' }] }));
    turnOf(t, 'brute');
    return t;
  };

  /**
   * SRD Uncanny Dodge: "halve the attack's damage against you (round down)."
   *
   * The engine held the damage the moment it was rolled, because the Rogue was
   * eligible; nothing on this surface could answer it or close it, so the
   * fight stopped there. The amount is the engine's — the caller names a
   * feature and no number at all.
   */
  it('answers the held damage, and the settlement deals what is left', () => {
    const t = alley('the-alley');
    const swing = expectOk(t.call('attack', { attacker: 'brute', target: 'nix', weapon: 'greatclub' }));
    expect(swing.resolution['hit']).toBe(true);
    const whole = hpOf(t, 'nix');
    // Held for the Rogue, so no hit points have moved yet.
    expect(hpOf(t, 'nix')).toBe(whole);

    const chances = offered(t, 'nix');
    expect(chances.find((one) => one.id === 'rogue:uncanny-dodge')).toMatchObject({
      window: 'damage-rolled',
      costsReaction: true,
    });

    const answered = expectOk(
      t.call('take_damage_reaction', { who: 'nix', feature: 'rogue:uncanny-dodge' }),
    );
    const prevented = answered.resolution['prevented'] as number;
    expect(prevented).toBeGreaterThan(0);

    const settled = expectOk(t.call('settle_damage'));
    const took = settled.resolution['amount'] as number;
    expect(took).toBeGreaterThan(0);
    expect(hpOf(t, 'nix')).toBe(whole - took);
    expectOk(t.call('end_turn', { who: 'brute' }));
  });

  /** Passing costs nothing, keeps the Reaction, and the whole blow lands. */
  it('declines the offer, and the damage settles unreduced', () => {
    const t = alley('halved');
    expectOk(t.call('attack', { attacker: 'brute', target: 'nix', weapon: 'greatclub' }));
    const whole = hpOf(t, 'nix');

    expectOk(t.call('decline_damage_reaction', { who: 'nix', feature: 'rogue:uncanny-dodge' }));
    expect(offered(t, 'nix')).toEqual([]);

    const settled = expectOk(t.call('settle_damage'));
    expect(hpOf(t, 'nix')).toBe(whole - (settled.resolution['amount'] as number));
  });

  /**
   * And a refusal a caller can act on, from the same window: a feature this
   * creature was not offered here. It names what it was not offered, and the
   * Reaction is still there to spend on what it was.
   */
  it('refuses a feature nobody offered against this blow, and spends nothing', () => {
    const t = alley('the-blow');
    expectOk(t.call('attack', { attacker: 'brute', target: 'nix', weapon: 'greatclub' }));
    const before = t.campaign.state().rollsIssued;

    const refusal = expectRefused(
      t.call('take_damage_reaction', { who: 'nix', feature: 'fighter:indomitable' }),
    );
    expect(refusal.code).toBe('not_offered');
    expect(t.campaign.state().rollsIssued).toBe(before);
    expect(offered(t, 'nix').map((one) => one.id)).toContain('rogue:uncanny-dodge');
  });
});

// — the D20 Test whose effects have not occurred ———————————————————————————

describe('a Fighter can push a check that has already come back', () => {
  const wall = (seed: string) => {
    const t = table(seed);
    expectOk(t.call('create_character', { id: 'bram', choices: fighter() }));
    return t;
  };

  /**
   * SRD Tactical Mind: "When you fail an ability check, you can expend a use of
   * your Second Wind ... you roll 1d10 and add the number rolled to the ability
   * check."
   *
   * The window is opened by the DM's check, because a DC is a number and the
   * model's surface carries none. Answering it is the *character's*, which is
   * why the door is here: the feature is a player's to spend.
   */
  it('takes the offer against the roll, and the new total is the engine’s', () => {
    const t = wall('tactical-mind');
    // A wall nobody could climb, so the check fails and the window opens.
    const check = expectOk(
      t.rule('ability_check', { who: 'bram', ability: 'str', skill: 'athletics', dc: 30, because: 'the wall' }),
    );
    expect(check.resolution['success']).toBe(false);

    const chances = offered(t, 'bram');
    expect(chances.find((one) => one.id === 'fighter:tactical-mind')).toMatchObject({
      window: 'test-rolled',
      // SRD grants it as a bare permission: no Reaction is spent.
      costsReaction: false,
    });

    const before = check.resolution['total'] as number;
    const pushed = expectOk(
      t.call('take_test_reaction', { who: 'bram', feature: 'fighter:tactical-mind' }),
    );
    expect(pushed.resolution['total'] as number).toBeGreaterThan(before);

    // SRD: "If the check still fails, this use of Second Wind isn't expended."
    // Either way the window closes from the surface that opened it.
    expectOk(t.rule('settle_test'));
  });

  /**
   * Passing costs nothing — no die, no use out of the pool — and the offer is
   * gone, which is what lets the settlement close the window.
   */
  it('declines the offer, and nothing is thrown or spent for it', () => {
    const t = wall('declined-test');
    expectOk(
      t.rule('ability_check', { who: 'bram', ability: 'str', skill: 'athletics', dc: 30, because: 'the wall' }),
    );
    const before = t.campaign.state().rollsIssued;

    expectOk(t.call('decline_test_reaction', { who: 'bram', feature: 'fighter:tactical-mind' }));
    expect(offered(t, 'bram')).toEqual([]);
    expect(t.campaign.state().rollsIssued).toBe(before);
    expect(poolLeft(t, 'bram', 'second-wind')).toBe(2);

    expect(expectOk(t.rule('settle_test')).resolution['settled']).toBe(true);
  });

  it('refuses a push when no roll is waiting, and spends no use', () => {
    const t = wall('no-test');
    const refusal = expectRefused(
      t.call('take_test_reaction', { who: 'bram', feature: 'fighter:tactical-mind' }),
    );
    expect(refusal.code).toBe('no_pending_test');
    expect(poolLeft(t, 'bram', 'second-wind')).toBe(2);
  });
});
