/**
 * The two route questions, asked and answered through the door.
 *
 * `commands/command.ts` splits them, and the split is only worth anything to a
 * caller that can act on either one:
 *
 * | code | what it wants | what closes it, **here** |
 * |---|---|---|
 * | `route_required` | which spaces were crossed | the same tool call again, with `move.route` or `activate_spell.via` filled in |
 * | `single_steps_required` | each space settled before the next is entered | several `move` calls, one 5-foot step each |
 *
 * Before this file the first line was a promise nothing could keep: `move`
 * declared `establishes: ['route']` and had no field to receive one, and
 * `activate_spell` did not exist at all — so a model-driven session handed
 * `route_required` could read `satisfyWith`, look for the field it named, and
 * find nothing. A refusal a caller cannot act on is the same defect one layer
 * up from the one `f8624b5` closed in the engine.
 *
 * **A route is a statement of fact, not a number the caller produced.** The
 * caller says which spaces the creature walked through; the engine checks the
 * route is a shortest path between two endpoints *it* computed (`checkRoute`
 * refuses anything else), reads the ground it already holds space by space,
 * and produces the cost itself. The tests below turn on exactly that: the
 * charged cost and the creatures a beam catches are numbers no endpoint could
 * have produced, and no tool argument names either.
 *
 * **This file imports no engine**, which is the same claim `fight.test.ts`
 * makes and the reason `declare_difficult_terrain` is on the surface: the mire
 * that provokes the ground's question is laid down by a tool call like
 * everything else, so the round trip is a model-driven caller's from end to
 * end. A field answering a question nothing on this surface could provoke
 * would have been half a door.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  createCampaign,
  createSurface,
  TOOLS,
  type Campaign,
  type InvalidOutcome,
  type NeedsContextOutcome,
  type OkOutcome,
  type ToolOutcome,
} from '@ie/tools';

// — a table, and two casters who between them own both questions ——————————————

const common = {
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  equipped: [],
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
};

/** A level 5 Cleric: Spirit Guardians is the one Emanation a creature carries. */
const CLERIC: Record<string, unknown> = {
  ...common,
  name: 'Brannor',
  classId: 'cleric',
  level: 5,
  abilities: {
    method: 'standard-array',
    assignment: { str: 14, dex: 12, con: 13, int: 10, wis: 15, cha: 8 },
  },
  abilityIncreases: { wis: 2, con: 1 },
  classSkills: ['insight', 'religion'],
  subclassId: 'life-domain',
  cantrips: ['sacred-flame', 'guidance', 'light', 'thaumaturgy'],
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
  featureChoices: {
    'human:skillful': ['perception'],
    'cleric:divine-order': ['Protector'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'cleric:ability-score-improvement': { featId: 'savage-attacker' },
  },
};

/** A level 5 Druid: Moonbeam is the one area a later action walks across a room. */
const DRUID: Record<string, unknown> = {
  ...common,
  name: 'Fenn',
  classId: 'druid',
  level: 5,
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 13, con: 14, int: 8, wis: 15, cha: 12 },
  },
  abilityIncreases: { wis: 2, con: 1 },
  classSkills: ['nature', 'survival'],
  subclassId: 'circle-of-the-land',
  cantrips: ['poison-spray', 'guidance', 'produce-flame'],
  preparedSpells: [
    'moonbeam',
    'cure-wounds',
    'charm-person',
    'thunderwave',
    'animal-friendship',
    'healing-word',
    'hold-person',
    'faerie-fire',
    'entangle',
  ],
  featureChoices: {
    'human:skillful': ['perception'],
    'druid:primal-order': ['Magician'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'druid:ability-score-improvement': { featId: 'savage-attacker' },
  },
};

interface Table {
  readonly campaign: Campaign;
  readonly surface: ReturnType<typeof createSurface>;
  call(tool: string, input?: unknown): ToolOutcome;
}

/** A caller that numbers its own `tool_use.id`s, exactly as a transport does. */
function table(seed: string): Table {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  return {
    campaign,
    surface,
    call: (tool, input: unknown = {}) => {
      calls += 1;
      return surface.call({ tool, input, commandId: `toolu_${calls}` });
    },
  };
}

const expectOk = (outcome: ToolOutcome): OkOutcome => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome;
};

const expectAsked = (outcome: ToolOutcome): NeedsContextOutcome => {
  if (outcome.status !== 'needs-context') {
    throw new Error(
      `expected needs-context, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 900)}`,
    );
  }
  return outcome;
};

/** The cleric to the west, the druid in the lane beside them, and a fight on. */
function openTheRoom(t: Table): void {
  expectOk(t.call('create_character', { id: 'brannor', choices: CLERIC }));
  expectOk(t.call('create_character', { id: 'fenn', choices: DRUID }));
  // One side, so nobody is offered an Opportunity Attack: these tests are
  // about the ground and the beam, not about the action economy.
  expectOk(t.call('declare_side', { who: 'brannor', side: 'party' }));
  expectOk(t.call('declare_side', { who: 'fenn', side: 'party' }));
  expectOk(t.call('set_scene', { width: 400, depth: 400, height: 40 }));
  expectOk(t.call('add_landmark', { name: 'the ford', at: { x: 100, y: 100 } }));
  expectOk(t.call('add_landmark', { name: 'the cairn', at: { x: 100, y: 200 } }));
}

/** East is +x, which is bearing 90: "0 is north, 90 is east". */
const EAST = 90;

interface Space {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const at = (x: number, y: number): Space => ({ x, y, z: 0 });

/** Whose turn it is, from the surface's own observation. */
const turnOf = (t: Table): string | null => t.surface.observe().turnOf;

/**
 * Hand the turn on and go round to this creature again.
 *
 * A spell activated on a *later* turn is the whole shape of `activateSpell`,
 * and the casting spent this turn's action — so the first `end_turn` is not
 * optional bookkeeping, it is what makes the next action affordable.
 */
function laterTurnOf(t: Table, who: string): void {
  expectOk(t.call('end_turn'));
  for (let n = 0; n < 6 && turnOf(t) !== who; n += 1) expectOk(t.call('end_turn'));
  expect(turnOf(t)).toBe(who);
}

// — the ground's question, and the field that answers it ————————————————————————

describe('ground that disagrees with itself is answered by `move.route`', () => {
  /**
   * The cleric, on their own turn, one step west of a single space of mire.
   *
   * One space is the whole point: a patch covering every space a shortest
   * route could enter charges them all the same and is never asked about, and
   * a patch covering one of the three is ground whose cost depends on which
   * spaces were crossed.
   */
  function mired(seed = 'the-mire'): Table {
    const t = table(seed);
    openTheRoom(t);
    expectOk(t.call('place_creature', { who: 'brannor', fromLandmark: 'the ford', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'fenn', fromLandmark: 'the cairn', feet: 0 }));
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'brannor' }] }));
    expectOk(
      t.call('declare_difficult_terrain', { patch: 'the mire', at: { x: 110, y: 100 }, radius: 0 }),
    );
    return t;
  }

  /**
   * **The patch is named back, which is what makes the tool worth having.** The
   * move reports the table's own word for the ground that charged it, so the
   * narration and the mechanics are talking about the same mire — and the
   * extra five feet are explained rather than merely charged.
   */
  it('is declared through a tool, and charges the glossary’s rate under its own name', () => {
    const t = mired();
    const crossed = expectOk(
      t.call('move', {
        who: 'brannor',
        fromLandmark: 'the ford',
        feet: 10,
        bearing: EAST,
        route: [at(105, 100), at(110, 100)],
      }),
    );
    expect(crossed.resolution['feetMoved']).toBe(10);
    // Ten feet, one space of which is mire: 5 + 10. The rate is the glossary's
    // and no call named it.
    expect(crossed.resolution['movementCost']).toBe(15);
    expect(crossed.resolution['terrain']).toEqual(['the mire']);
  });

  /** Fifteen feet east of the ford: (105, 100), (110, 100), (115, 100). */
  const WALK = { who: 'brannor', fromLandmark: 'the ford', feet: 15, bearing: EAST };
  const ROUTE = [at(105, 100), at(110, 100), at(115, 100)];

  it('asks rather than refusing, and says which question it is asking', () => {
    const t = mired();
    const asked = expectAsked(t.call('move', WALK));
    expect(asked.code).toBe('route_required');
    expect(asked.establish[0]?.kind).toBe('route');
  });

  /**
   * **The request has to be answerable from what the outcome carries.** A
   * caller holding only this outcome must be able to build the route, so the
   * request names both endpoints and how many spaces lie between them, and the
   * door that receives it is on the outcome as well.
   */
  it('names the field, the tool that has it, and both ends of the walk', () => {
    const t = mired();
    const request = expectAsked(t.call('move', WALK)).establish[0]!;
    expect(request.satisfyWith).toContain('route');
    expect(request.tools).toContain('move');
    expect(request.need).toContain('3 spaces');
    expect(request.because).toContain('extra foot');
  });

  it('spends nothing while it waits for an answer', () => {
    const t = mired();
    const before = t.campaign.log().length;
    t.call('move', WALK);
    expect(t.campaign.log()).toHaveLength(before);
    expect(t.surface.observe().creatures[0]?.budget?.movementFeet).toBe(30);
  });

  /**
   * **The loop, closed through the door.** The same call again with the one
   * field the request named, and the move resolves — at 5 + 10 + 5 feet, a
   * cost that is neither the 15 the endpoints imply nor the 30 an all-mire
   * charge would give. Neither endpoint could have produced it, and no
   * argument in the call carries it: the caller said which spaces, and the
   * engine read its own ground.
   */
  it('resolves when the same call carries the route, at the cost the route implies', () => {
    const t = mired();
    expectAsked(t.call('move', WALK));

    const moved = expectOk(t.call('move', { ...WALK, route: ROUTE }));
    expect(moved.resolution['feetMoved']).toBe(15);
    expect(moved.resolution['movementCost']).toBe(20);
    expect(t.surface.observe().creatures[0]?.budget?.movementFeet).toBe(10);
  });

  /**
   * **A route is checked, not taken on trust**, which is the other half of why
   * stating one is not producing a number. Two spaces is not a fifteen-foot
   * walk, and the engine says so rather than charging whatever it was handed.
   */
  it('refuses a route that is not the walk it was asked about', () => {
    const t = mired();
    const short = t.call('move', { ...WALK, route: [at(105, 100), at(110, 100)] });
    expect(short.status).toBe('refused');
    expect(short.status === 'refused' ? short.code : '').toBe('bad_route');
  });

  /**
   * And a route that dodges the mire is charged as the walk it describes. A
   * shortest path may wander one space off the straight line and still arrive
   * in three steps, so this is a real route rather than a discount — the
   * engine charged the ground these spaces are made of, which happens to be
   * open floor. What the caller cannot do is say what it cost.
   */
  it('charges a legal route round the mire what that ground costs', () => {
    const t = mired();
    const round = expectOk(
      t.call('move', { ...WALK, route: [at(105, 105), at(110, 105), at(115, 100)] }),
    );
    expect(round.resolution['feetMoved']).toBe(15);
    expect(round.resolution['movementCost']).toBe(15);
    expect(round.resolution['terrain']).toEqual([]);
  });
});

// — the beam's question, and the field that answers it ——————————————————————————

describe('an area walked across a room is answered by `activate_spell.via`', () => {
  /**
   * The druid puts the beam down twenty feet short of the cleric and then, on
   * a later turn, walks it past them. The cleric is standing still throughout:
   * whether anything happens to them depends entirely on what the beam crossed.
   */
  function beamed(seed = 'the-beam'): { t: Table; castingId: string } {
    const t = table(seed);
    openTheRoom(t);
    expectOk(t.call('place_creature', { who: 'fenn', fromLandmark: 'the cairn', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'brannor', fromLandmark: 'the cairn', feet: 40, bearing: EAST }));
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'fenn' }] }));
    const cast = expectOk(
      t.call('cast_spell', {
        caster: 'fenn',
        spellId: 'moonbeam',
        targets: [],
        slotLevel: 2,
        at: { x: 120, y: 200 },
      }),
    );
    laterTurnOf(t, 'fenn');
    return { t, castingId: String(cast.resolution['castingId']) };
  }

  /** From (120, 200) to (160, 200): forty feet, and the cleric stands at 140. */
  const DESTINATION = { x: 160, y: 200 };
  const VIA = [
    at(125, 200),
    at(130, 200),
    at(135, 200),
    at(140, 200),
    at(145, 200),
    at(150, 200),
    at(155, 200),
  ];

  it('asks which spaces the beam crossed, under the code that names the field', () => {
    const { t, castingId } = beamed();
    const asked = expectAsked(
      t.call('activate_spell', { caster: 'fenn', castingId, targets: [], to: DESTINATION }),
    );
    expect(asked.code).toBe('route_required');
    expect(asked.establish[0]?.kind).toBe('route');
    expect(asked.establish[0]?.satisfyWith).toContain('via');
    expect(asked.establish[0]?.tools).toContain('activate_spell');
  });

  it('spends no action while it waits for an answer', () => {
    const { t, castingId } = beamed();
    const before = t.campaign.log().length;
    t.call('activate_spell', { caster: 'fenn', castingId, targets: [], to: DESTINATION });
    expect(t.campaign.log()).toHaveLength(before);
    expect(t.surface.observe().creatures.find((c) => c.id === 'fenn')?.budget?.action).toBe(true);
  });

  /**
   * **The answer, and what it costs the creature standing in the way.** The
   * cleric is twenty feet along a forty-foot sweep. With the route stated the
   * beam arrives on their space and the engine rolls their save and its own
   * damage; with only two endpoints there is nothing that says it ever passed
   * over them. That difference is the whole of what `via` buys, and the
   * caller supplied no part of it but the spaces.
   */
  it('resolves when the same call carries `via`, catching what the beam crossed', () => {
    const { t, castingId } = beamed();
    expectAsked(t.call('activate_spell', { caster: 'fenn', castingId, targets: [], to: DESTINATION }));

    const before = t.surface.observe().creatures.find((c) => c.id === 'brannor')!.hp;
    const walked = expectOk(
      t.call('activate_spell', { caster: 'fenn', castingId, targets: [], to: DESTINATION, via: VIA }),
    );

    expect(walked.events.filter((e) => e.type === 'spell-origin-moved')).toHaveLength(8);
    const outcomes = walked.resolution['outcomes'] as readonly { target: string }[];
    expect(outcomes.map((o) => o.target)).toContain('brannor');
    expect(t.surface.observe().creatures.find((c) => c.id === 'brannor')!.hp).toBeLessThan(before);
  });
});

// — the carried area's question, which several calls answer ————————————————————

describe('a carried area is answered by several `move` calls, one space each', () => {
  /**
   * The cleric carries Spirit Guardians across the druid's space. An Emanation
   * moves with its origin, so what the walk sweeps over is the cleric's to
   * state — and a creature that fails its save against what it is walked into
   * can stop the walk, which is why a route stated up front is not the answer.
   */
  function carried(seed = 'the-spirits'): Table {
    const t = table(seed);
    openTheRoom(t);
    expectOk(t.call('place_creature', { who: 'brannor', fromLandmark: 'the ford', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'fenn', fromLandmark: 'the ford', feet: 30, bearing: EAST }));
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'brannor' }] }));
    expectOk(
      t.call('cast_spell', {
        caster: 'brannor',
        spellId: 'spirit-guardians',
        targets: [],
        slotLevel: 3,
        damageType: 'radiant',
      }),
    );
    return t;
  }

  const WALK = { who: 'brannor', fromLandmark: 'the ford', feet: 15, bearing: EAST };

  it('asks for single steps, and not for a route', () => {
    const t = carried();
    const asked = expectAsked(t.call('move', WALK));
    expect(asked.code).toBe('single_steps_required');
    expect(asked.establish[0]?.satisfyWith).toContain('one space');
  });

  /**
   * **And filling in `route` does not answer it.** The two codes are not
   * decoration: a caller that read the wrong one, filled in the field the
   * other question names and sent it would be asked the same thing again. This
   * is that loop, shown not to close — which is why the codes had to split.
   */
  it('is not answered by the field the ground’s question names', () => {
    const t = carried();
    const again = t.call('move', {
      ...WALK,
      route: [at(105, 100), at(110, 100), at(115, 100)],
    });
    expect(again.status).toBe('needs-context');
    expect(again.status === 'needs-context' ? again.code : '').toBe('single_steps_required');
  });

  /**
   * What does answer it: the same walk as three calls, each one settled before
   * the next is sent. The spirits arrive on the druid partway along, and the
   * step after that is refused until the engine has been told to settle what
   * the arrival raised — which is the rule the single-step remedy exists for.
   */
  it('resolves as three calls of one space each, settling what each raises', () => {
    const t = carried();
    const before = t.surface.observe().creatures.find((c) => c.id === 'fenn')!.hp;

    let settlements = 0;
    for (const feet of [5, 10, 15]) {
      expectOk(t.call('move', { who: 'brannor', fromLandmark: 'the ford', feet, bearing: EAST }));
      if (t.surface.observe().owed.owedAreaEffects === 0) continue;

      // **Settled before the next space is entered, and not by convention.**
      // The next step is refused while the arrival stands unanswered, which is
      // the rule the single-step remedy exists for: what a creature walks its
      // aura onto can stop the walk, so the engine will not hear about the
      // space after until this one is closed.
      const early = t.call('move', {
        who: 'brannor',
        fromLandmark: 'the ford',
        feet: feet + 5,
        bearing: EAST,
      });
      expect(early.status).toBe('refused');
      expect(early.status === 'refused' ? early.code : '').toBe('area_effect_owed');

      expectOk(t.call('settle_area_effects'));
      settlements += 1;
    }

    expect(settlements).toBeGreaterThan(0);
    expect(t.surface.observe().creatures.find((c) => c.id === 'brannor')?.budget?.movementFeet).toBe(15);
    expect(t.surface.observe().creatures.find((c) => c.id === 'fenn')!.hp).toBeLessThan(before);
  });
});

// — the declaration and the schema, held together ——————————————————————————————

/**
 * Which tool answers a route request, and in which field.
 *
 * Written here rather than derived, because the thing being checked is that
 * the two halves agree: a tool that declares `establishes: ['route']` and has
 * no field to receive one is the defect this file exists about, and it is
 * invisible to the type system — `establishes` is a list of kinds, and a Zod
 * schema is a value nothing compares it against. So the pairing is stated, and
 * both directions are asserted: a new route door with no field fails, and a
 * field whose tool forgot to declare the kind fails too.
 */
const ROUTE_FIELDS: Readonly<Record<string, string>> = {
  activate_spell: 'via',
  move: 'route',
};

describe('the door declared for kind `route` can receive one', () => {
  const surface = createSurface(createCampaign({ content: SRD_CONTENT, seed: 'doors' }));

  it('is declared by exactly the tools that have a field for it', () => {
    const declaring = TOOLS.filter((t) => t.establishes.includes('route'))
      .map((t) => t.name)
      .sort();
    expect(declaring).toEqual(Object.keys(ROUTE_FIELDS).sort());
  });

  it('is the list `doorsFor` hands to a caller', () => {
    expect([...surface.doorsFor('route')].sort()).toEqual(Object.keys(ROUTE_FIELDS).sort());
  });

  /**
   * **A schema with no such field would strip it in silence.** Zod objects
   * drop unknown keys rather than complaining, so a call carrying a route into
   * a tool that has nowhere to put one succeeds, moves the creature, and
   * charges the open-ground cost. Sending a malformed value at the field is
   * what tells the two apart: an issue at that path can only come from a
   * schema that has the field and checked it.
   */
  it('validates a malformed route at the field, which is what proves it exists', () => {
    for (const [tool, field] of Object.entries(ROUTE_FIELDS)) {
      const outcome = surface.call({
        tool,
        input: { [field]: 'through the trees' },
        commandId: `probe:${tool}`,
      });
      expect(outcome.status).toBe('invalid');
      expect((outcome as InvalidOutcome).issues.map((issue) => issue.path)).toContain(field);
    }
  });

  /** And a route is a list of spaces, not a number: every entry is a point. */
  it('takes spaces, and refuses a bare number where a space belongs', () => {
    for (const [tool, field] of Object.entries(ROUTE_FIELDS)) {
      const outcome = surface.call({
        tool,
        input: { [field]: [15] },
        commandId: `probe-number:${tool}`,
      });
      expect(outcome.status).toBe('invalid');
      expect((outcome as InvalidOutcome).issues.some((issue) => issue.path.startsWith(field))).toBe(
        true,
      );
    }
  });
});
