/**
 * The stat-block lines the engine can roll, and the door that rolls them.
 *
 * `forcePrintedSave` shipped finished: it reads the DC and the dice off the
 * block, throws a save per creature the table named, halves or zeroes the
 * damage the way the line's own `_Success:_` clause says, applies Evasion off
 * each target and spends whichever slot the heading names. It was on the
 * engine's barrel and in **no tool on either surface**, so every CR ≤ 5 line
 * whose sentence the parser structured was a heading a caller could read and
 * could not have rolled.
 *
 * And `look` could not tell those from the two hundred-odd lines beside them.
 * A caller reading `printed.actions` saw a name, a sentence and a recharge —
 * nothing saying which of them the engine would roll — so choosing between the
 * door that rolls and the door that hands the sentence over was guesswork over
 * English. {@link ObservedPrintedLine.engineRollsTheSave} is that flag.
 *
 * The door is the **DM's**, for the reason `take_printed_action` is: who is
 * standing in a 15-foot Cone is measured from an origin and a facing nobody
 * has declared, so the head count is the table's decision and is the one thing
 * the call takes. Everything a die decides stays in the engine.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createDmSurface, createSurface, type ToolOutcome } from '@ie/tools';

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 800)}`,
    );
  }
  return outcome;
};

function table(seed = 'the-breath-lands') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    return surface.call({ tool, input, commandId: `toolu_${calls}` });
  };
  return { campaign, surface, call };
}

/** SRD Winter Wolf's second Actions line, as the book prints it — en dash and all. */
const COLD_BREATH = 'Cold Breath (Recharge 5–6)';

/** Three creatures in a room, which is the least a Cone can catch two of. */
function fight(seed?: string, monsterId = 'winter-wolf') {
  const t = table(seed);
  expectOk(t.call('add_creature', { id: 'fang', monsterId }));
  expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
  expectOk(t.call('add_creature', { id: 'snik', monsterId: 'goblin-warrior' }));
  expectOk(t.call('declare_side', { who: 'fang', side: 'wolves' }));
  expectOk(t.call('declare_side', { who: 'grish', side: 'goblins' }));
  expectOk(t.call('declare_side', { who: 'snik', side: 'goblins' }));
  expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the drift', at: { x: 10, y: 10 } }));
  expectOk(t.call('place_creature', { who: 'fang', fromLandmark: 'the drift', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'grish', fromCreature: 'fang', feet: 10, bearing: 0 }));
  expectOk(t.call('place_creature', { who: 'snik', fromCreature: 'fang', feet: 10, bearing: 20 }));
  expectOk(
    t.call('roll_initiative', {
      combatants: [{ who: 'fang' }, { who: 'grish' }, { who: 'snik' }],
    }),
  );
  return t;
}

/** End turns until it is this creature's, which is when it may spend anything. */
function turnOf(t: ReturnType<typeof table>, who: string): void {
  for (let guard = 0; guard < 12; guard += 1) {
    if (t.surface.observe().turnOf === who) return;
    expectOk(t.call('end_turn', {}));
  }
  throw new Error(`the order never came round to ${who}`);
}

const blockOf = (t: ReturnType<typeof table>, id: string) => {
  const found = t.surface.observe().creatures.find((creature) => creature.id === id)?.printed;
  if (found === null || found === undefined) throw new Error(`${id} states no block`);
  return found;
};

describe('the door that rolls a printed line’s saving throw', () => {
  it('throws one save per creature the table named, and lands what the block prints', () => {
    const t = fight();
    turnOf(t, 'fang');

    const out = expectOk(
      t.call('force_printed_save', {
        who: 'fang',
        line: COLD_BREATH,
        targets: ['grish', 'snik'],
      }),
    );

    // One save each, at the DC the block prints and nobody stated.
    const outcomes = out.resolution['outcomes'] as readonly Record<string, unknown>[];
    expect(outcomes).toHaveLength(2);
    expect(outcomes.map((one) => one['target'])).toEqual(['grish', 'snik']);
    for (const one of outcomes) {
      expect(one['dc']).toBe(12);
      expect(typeof one['natural']).toBe('number');
      expect(typeof one['success']).toBe('boolean');
      expect(typeof one['damage']).toBe('number');
    }

    // The engine rolled. That is the whole difference between this door and
    // the one that hands the sentence over, which throws nothing at all.
    const recorded = out.events.filter((event) => event.type === 'roll-recorded');
    expect(recorded).toHaveLength(2);
    expect((recorded[0] as { label: string }).label).toContain('Constitution save');
    expect(out.events.filter((event) => event.type === 'damage-dice-recorded')).not.toHaveLength(0);

    // And the same line was taken, so the same event goes into the log under
    // the printed spelling, with the Action gone and the recharge spent.
    const taken = out.events.filter((event) => event.type === 'stated-action-taken');
    expect(taken).toHaveLength(1);
    expect((taken[0] as { line: string }).line).toBe(COLD_BREATH);
    expect(out.events.some((event) => event.type === 'action-spent')).toBe(true);
    expect(out.events.some((event) => event.type === 'printed-line-expended')).toBe(true);
    expect(out.resolution['line']).toBe(COLD_BREATH);
    expect(out.resolution['expended']).toBe(true);

    // The part the engine did not settle is the targeting clause and nothing
    // else — who stands in a Cone is the table's answer.
    expect(out.unverified.join(' ')).toContain('15-foot Cone');
  });

  it('asks for the head count rather than refusing, and names itself as the door', () => {
    const t = fight('nobody-said-who');
    turnOf(t, 'fang');

    const out = t.call('force_printed_save', { who: 'fang', line: COLD_BREATH });
    expect(out.status).toBe('needs-context');
    if (out.status !== 'needs-context') return;
    expect(out.code).toBe('undeclared_targets');
    expect(out.reason).toContain('15-foot Cone');

    // The answer is this call again with `targets` filled in, so the door it
    // names is itself — `add_creature` is no help at all to a caller being
    // asked who the breath caught.
    const doors = out.establish.flatMap((request) => request.tools);
    expect(doors).toEqual(['force_printed_save']);
    expect(out.establish[0]!.satisfyWith).toContain('targets');

    // Nothing was spent asking. The Action is still there.
    expect(t.campaign.log().some((event) => event.type === 'action-spent')).toBe(false);
    expect(t.surface.observe().creatures.find((c) => c.id === 'fang')!.budget!.action).toBe(true);
  });

  it('spends the Bonus Action when the heading is a Bonus Action’s', () => {
    // SRD Gorgon's Trample is printed under Bonus Actions, and a heading in a
    // stat block says what the line under it costs.
    const t = fight('the-gorgon-tramples', 'gorgon');
    turnOf(t, 'fang');

    // "one creature within 5 feet **that has the Prone condition**": the other
    // fact this reader takes off a targeting clause, so a trample forced on a
    // creature still on its feet is refused before anything is spent.
    const upright = t.call('force_printed_save', {
      who: 'fang',
      line: 'Trample',
      targets: ['grish'],
    });
    expect(upright.status).toBe('refused');
    if (upright.status === 'refused') expect(upright.code).toBe('target_not_eligible');
    expectOk(
      t.call('rule_condition', { who: 'grish', condition: 'prone', ruling: 'the gorgon shoved it' }),
    );

    const out = expectOk(
      t.call('force_printed_save', { who: 'fang', line: 'Trample', targets: ['grish'] }),
    );
    expect(out.events.some((event) => event.type === 'bonus-action-spent')).toBe(true);
    expect(out.events.some((event) => event.type === 'action-spent')).toBe(false);
    expect(out.events.some((event) => event.type === 'stated-bonus-action-taken')).toBe(true);
    expect(out.resolution['line']).toBe('Trample');
    expect((out.resolution['outcomes'] as readonly Record<string, unknown>[])[0]!['dc']).toBe(16);
  });

  it('refuses a line whose sentence it could not structure, naming the other door', () => {
    // SRD Gold Dragon Wyrmling's Weakening Breath: "_Failure:_ The target has
    // Disadvantage on Strength-based D20 Tests and subtracts 2 (1d4) from its
    // damage rolls." A failure clause the reader cannot start on refuses the
    // line whole, because a save the engine rolls and then does nothing with
    // is a die thrown for no reason. (The Brass Dragon Wyrmling's Sleep
    // Breath, which used to stand here, is read now: a deepening may carry a
    // lifetime of its own.)
    const t = fight('weakening', 'gold-dragon-wyrmling');
    turnOf(t, 'fang');

    const out = t.call('force_printed_save', {
      who: 'fang',
      line: 'Weakening Breath',
      targets: ['grish'],
    });
    expect(out.status).toBe('refused');
    if (out.status !== 'refused') return;
    expect(out.code).toBe('line_states_no_save');

    // And nothing was spent for the refusal.
    expect(t.campaign.log().some((event) => event.type === 'action-spent')).toBe(false);
  });

  it('rolls the breath whose second rung deepens into a span of its own', () => {
    // SRD Brass Dragon Wyrmling's Sleep Breath: "_Failure:_ Incapacitated
    // until the end of its next turn, at which point it repeats the save.
    // _Second Failure:_ The Unconscious condition for 1 minute." Both rungs
    // are the engine's, and so are the two endings the book prints for the
    // deeper one — a blow, and a neighbour's Action — so nothing of the line
    // reaches the table but the Cone.
    const t = fight('sleeping', 'brass-dragon-wyrmling');
    turnOf(t, 'fang');

    const out = expectOk(
      t.call('force_printed_save', {
        who: 'fang',
        line: 'Sleep Breath',
        targets: ['grish'],
      }),
    );
    const outcomes = out.resolution['outcomes'] as readonly Record<string, unknown>[];
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!['dc']).toBe(11);
    expect(out.events.filter((event) => event.type === 'roll-recorded')).toHaveLength(1);
    expect(out.unverified.join(' ')).not.toContain('This effect ends for the target');
    expect(out.unverified).toHaveLength(1);
  });

  /**
   * SRD Vampire Spawn's Bite: "one creature within 5 feet that is willing or
   * that has the Grappled, Incapacitated, or Restrained condition."
   *
   * The engine checks the three conditions off the creature; the willingness
   * is fiction and no state answers it, so the DM's door carries the word and
   * a caller who has not said it is **asked** rather than refused.
   */
  it('asks whether an unheld creature is willing, and bites one that is', () => {
    const t = fight('the-vampire-bites', 'vampire-spawn');
    turnOf(t, 'fang');

    const asked = t.call('force_printed_save', {
      who: 'fang',
      line: 'Bite',
      targets: ['grish'],
    });
    expect(asked.status).toBe('needs-context');
    if (asked.status !== 'needs-context') return;
    expect(asked.code).toBe('undeclared_consent');
    expect(asked.reason).toContain('willing');
    // Nothing was spent asking: the Action is still the vampire's.
    expect(t.campaign.log().some((event) => event.type === 'action-spent')).toBe(false);

    const bitten = expectOk(
      t.call('force_printed_save', {
        who: 'fang',
        line: 'Bite',
        targets: ['grish'],
        willing: ['grish'],
      }),
    );
    expect(bitten.resolution['outcomes']).toHaveLength(1);
  });

  /**
   * SRD Pseudodragon's Sting: "_Failure by 5 or More:_ While Poisoned, the
   * target also has the Unconscious condition, **which ends early if the
   * target takes damage or a creature within 5 feet of it takes an action to
   * wake it**."
   *
   * The second half is `wake_creature`, and it is on **both** surfaces: one
   * creature spending its own Action to end an effect on another is something
   * a player does as often as a DM does.
   */
  it('lets a neighbour spend an Action shaking the sleeper, on either surface', () => {
    for (const seed of ['sting-a', 'sting-b', 'sting-c', 'sting-d', 'sting-e', 'sting-f']) {
      const t = fight(seed, 'pseudodragon');
      turnOf(t, 'fang');
      const out = expectOk(
        t.call('force_printed_save', { who: 'fang', line: 'Sting', targets: ['grish'] }),
      );
      const conditions = t.surface
        .observe()
        .creatures.find((one) => one.id === 'grish')!.conditions;
      if (!conditions.includes('unconscious')) continue;

      // A goblin standing beside the sleeper spends its Action and the
      // Unconscious goes; the hour of Poison the book hung it on runs on.
      turnOf(t, 'snik');
      expectOk(t.call('wake_creature', { who: 'snik', target: 'grish' }));
      const awake = t.surface.observe().creatures.find((one) => one.id === 'grish')!.conditions;
      expect(awake).not.toContain('unconscious');
      expect(awake).toContain('poisoned');
      expect(out.unverified).toHaveLength(1);

      // And a creature holding nothing a shake would end is refused rather
      // than charged: an Action spent on nothing is what the verb exists to
      // prevent.
      const nothing = t.call('wake_creature', { who: 'snik', target: 'grish' });
      expect(nothing.status).toBe('refused');
      if (nothing.status === 'refused') expect(nothing.code).toBe('nothing_to_wake');
      return;
    }
    throw new Error('no seed missed the sting by five');
  });

  it('publishes the shake on the player’s door too', () => {
    const player = createSurface(createCampaign({ content: SRD_CONTENT, seed: 'shaking' }));
    expect(player.tools.map((one) => one.name)).toContain('wake_creature');
    const dm = createDmSurface(createCampaign({ content: SRD_CONTENT, seed: 'shaking' }));
    expect(dm.tools.map((one) => one.name)).toContain('wake_creature');
  });

  it('is the DM’s door and not the model’s', () => {
    const model = createSurface(createCampaign({ content: SRD_CONTENT, seed: 'walls' }));
    const dm = createDmSurface(createCampaign({ content: SRD_CONTENT, seed: 'walls' }));
    expect(dm.tools.map((one) => one.name)).toContain('force_printed_save');

    const out = model.call({ tool: 'force_printed_save', input: {}, commandId: 'toolu_1' });
    expect(out.status).toBe('invalid');
    if (out.status !== 'invalid') return;
    expect(out.code).toBe('unknown_tool');
  });

  it('takes no number the caller produced', () => {
    const t = fight('no-numbers');
    const out = t.call('force_printed_save', {
      who: 'fang',
      line: COLD_BREATH,
      targets: ['grish'],
      dc: 5,
    });
    expect(out.status).toBe('invalid');
    if (out.status !== 'invalid') return;
    // A strict object, so the key is not stripped in silence: the call is
    // rejected before the engine is asked and the DC the caller tried to state
    // is named back at them.
    expect(out.issues.map((issue) => issue.message).join(' ')).toContain('dc');
    expect(t.campaign.log().some((event) => event.type === 'action-spent')).toBe(false);
  });
});

describe('`look` says which printed lines the engine will roll', () => {
  it('flags the line whose save it can throw, and leaves the rest to narration', () => {
    const t = fight('reading-the-block');
    const block = blockOf(t, 'fang');

    const breath = block.actions.find((one) => one.name === COLD_BREATH)!;
    expect(breath.engineRollsTheSave).toBe(true);

    // The Bite beside it is an attack and is not on this list at all, which is
    // the distinction the report already kept.
    expect(block.actions.map((one) => one.name)).not.toContain('Bite');
  });

  it('says false for a line that forces a save its reader could not structure', () => {
    // SRD Gold Dragon Wyrmling: Weakening Breath prints `_Strength Saving
    // Throw:_` and the engine still will not roll it, because its failure is a
    // clause the reader cannot start on — so the flag is about what the engine
    // will do rather than about what the English says.
    const t = fight('the-wyrmling-is-read', 'gold-dragon-wyrmling');
    const block = blockOf(t, 'fang');

    const weakening = block.actions.find((one) => one.name === 'Weakening Breath')!;
    expect(weakening.text).toContain('Saving Throw');
    expect(weakening.engineRollsTheSave).toBe(false);

    // And the line beside it the engine *will* roll, under the same heading.
    const fire = block.actions.find((one) => one.name.startsWith('Fire Breath'))!;
    expect(fire.engineRollsTheSave).toBe(true);
  });

  it('says true for the breath whose second rung deepens into a lifetime', () => {
    // SRD Brass Dragon Wyrmling's Sleep Breath and SRD Silver Dragon
    // Wyrmling's Paralyzing Breath stood on the false side of this flag until
    // a deepening could carry a span or a repeat of its own.
    const brass = fight('the-brass-is-read', 'brass-dragon-wyrmling');
    const sleep = blockOf(brass, 'fang').actions.find((one) => one.name === 'Sleep Breath')!;
    expect(sleep.engineRollsTheSave).toBe(true);

    const silver = fight('the-silver-is-read', 'silver-dragon-wyrmling');
    const paralyzing = blockOf(silver, 'fang').actions.find(
      (one) => one.name === 'Paralyzing Breath',
    )!;
    expect(paralyzing.engineRollsTheSave).toBe(true);
  });

  it('says true for the graded failure it now reads', () => {
    // SRD Gorgon's Petrifying Breath used to stand for the family the reader
    // refused whole. Its second rung says only which condition replaces
    // which, which is `RepeatSave.onFailure`, so the engine rolls it.
    const t = fight('the-gorgon-is-read', 'gorgon');
    const block = blockOf(t, 'fang');

    const petrifying = block.actions.find((one) => one.name.startsWith('Petrifying Breath'))!;
    expect(petrifying.engineRollsTheSave).toBe(true);

    // And the Bonus Action the engine will roll, one section along.
    const trample = block.bonusActions.find((one) => one.name === 'Trample')!;
    expect(trample.engineRollsTheSave).toBe(true);
  });

  /**
   * SRD Sea Hag's Death Glare and SRD Incubus' Nightmare each print a failure
   * that branches on the target's Hit Points — "If the target has 20 Hit
   * Points or fewer, … . Otherwise, …" — and each stood on the other side of
   * this flag until the branch was read.
   */
  it('says true for the two lines that branch on the target’s Hit Points', () => {
    const hag = fight('the-hag-is-read', 'sea-hag');
    const glare = blockOf(hag, 'fang').actions.find((one) =>
      one.name.startsWith('Death Glare'),
    )!;
    expect(glare.engineRollsTheSave).toBe(true);

    const incubus = fight('the-incubus-is-read', 'incubus');
    const nightmare = blockOf(incubus, 'fang').bonusActions.find((one) =>
      one.name.startsWith('Nightmare'),
    )!;
    expect(nightmare.engineRollsTheSave).toBe(true);
  });

  /**
   * SRD Copper Dragon Wyrmling's Slowing Breath stood beside the Brass
   * Dragon's Sleep Breath on the false side of this flag until the reader
   * learned a rule about a turn: "The target can't take Reactions; its Speed
   * is halved; and it can take either an action or a Bonus Action on its
   * turn, not both. This effect lasts until the end of its next turn."
   */
  it('says true for the breath that changes what a turn may hold', () => {
    const t = fight('the-copper-is-read', 'copper-dragon-wyrmling');
    const block = blockOf(t, 'fang');

    const slowing = block.actions.find((one) => one.name.startsWith('Slowing Breath'))!;
    expect(slowing.text).toContain('not both');
    expect(slowing.engineRollsTheSave).toBe(true);
  });

  it('says false for a printed Bonus Action that forces nothing', () => {
    const t = fight('the-goblin-is-read');
    const block = blockOf(t, 'grish');
    const escape = block.bonusActions.find((one) => one.name === 'Nimble Escape')!;
    expect(escape.engineRollsTheSave).toBe(false);
  });
});
