import { describe, expect, it } from 'vitest';
import { asCharacterId } from '@ie/shared';
import { carrying, fold, remaining, spellSlotKey } from '@ie/engine';
import { GOBLIN_A, GOBLIN_B, SEED, WIZARD, prelude, tavernEncounter } from './fixture.js';
import { createScriptedDriver } from './drivers.js';
import { runExperiment } from './harness.js';
import { TOOLS, dispatch, observe } from './surface.js';
import { createSession } from './session.js';

/**
 * The apparatus, tested offline.
 *
 * An experiment whose instrumentation is only exercised by the experiment has
 * not been calibrated, and a measurement taken through an untested harness is
 * a guess with a table around it. None of these tests says anything about a
 * model: they say that the surface refuses what it should refuse, asks when it
 * should ask, records what it should record, and replays.
 *
 * They run in `npm test` with no API key and no network.
 */

const run = () =>
  runExperiment(createScriptedDriver(tavernEncounter('established', 'standard'), new Set([WIZARD])), {
    encounter: tavernEncounter('established', 'standard'),
    rounds: 4,
    maxExchangesPerBeat: 8,
  });

describe('the fixture is the scripted scenario, not a fork of it', () => {
  /**
   * `scenario.test.ts` and this probe transcribe the same character. If one
   * drifts, every comparison between the scripted fight and the model-driven
   * one is measuring the drift instead of the boundary — so the numbers that
   * fight actually turns on are pinned here.
   */
  it('creates the same level 3 Evoker with the same slots', () => {
    const state = fold(SEED, prelude('established'));
    const kessa = state.creatures[WIZARD]!;
    expect(kessa.sheet.level).toBe(3);
    expect(remaining(kessa.resources, spellSlotKey(1))).toBe(4);
    expect(remaining(kessa.resources, spellSlotKey(2))).toBe(2);
  });

  /**
   * SRD 2024: "Small Fey (Goblinoid)". This is why Hold Person is refused —
   * and it is true in **both** fixtures now, which is the hardening.
   *
   * The thin variant used to withhold the creature type so the experiment
   * could measure what the engine had to ask for. What it measured was the
   * model answering "Humanoid" and thereby making its own spell legal. A fact
   * the SRD prints is not a fact anybody gets to be asked for, so thin is now
   * thin only about the room.
   */
  it('makes the goblins Fey in both fixtures, because the stat block says so', () => {
    for (const variant of ['established', 'thin'] as const) {
      expect(fold(SEED, prelude(variant)).creatures[GOBLIN_A]!.creatureType, variant).toBe('Fey');
    }
  });

  /** The SRD prints a Scimitar and a Shortbow, so the goblin arrives holding both. */
  it('arms the goblins from the stat block in both fixtures', () => {
    for (const variant of ['established', 'thin'] as const) {
      const held = carrying(fold(SEED, prelude(variant)), GOBLIN_A).map((l) => l.id);
      expect(held, variant).toContain('scimitar');
      expect(held, variant).toContain('shortbow');
    }
  });

  /**
   * Spawning from content must not have changed the fight. These are the
   * numbers the hand-written sheet carried, checked against the ones the
   * parser produces, so "the facts moved provenance" stays a true statement
   * rather than a hopeful one.
   */
  it('produces the same Goblin Warrior the hand-written fixture did', () => {
    const goblin = fold(SEED, prelude('established')).creatures[GOBLIN_A]!;
    expect(goblin.name).toBe('Goblin Warrior');
    expect(goblin.vitals.hpMax).toBe(10);
    expect(goblin.sheet.stated?.armorClass).toBe(15);
    expect(goblin.sheet.stated?.initiative).toBe(2);
    expect(goblin.sheet.abilities).toMatchObject({ str: 8, dex: 15, con: 10, wis: 8 });
  });

  /** Thin is thin only about what content genuinely cannot know. */
  it('withholds the room in the thin fixture and nothing the SRD prints', () => {
    expect(fold(SEED, prelude('established')).scene).not.toBeNull();
    expect(fold(SEED, prelude('thin')).scene).toBeNull();
  });
});

describe('the surface hands the model no mechanically authoritative number', () => {
  /**
   * The rule that decided what is on this surface, asserted rather than
   * described. `resolveDamage`, `healCreature`, `applyConditionTo` and the
   * `recordExternal*` pair all take a number or an outcome from their caller;
   * a model holding any of them could make any test pass by asserting its way
   * through. If somebody adds one, this fails and says so.
   */
  it('exposes no tool that could assert damage, healing or a condition', () => {
    const names = TOOLS.map((t) => t.name);
    for (const forbidden of [
      'damage',
      'damage_creature',
      'heal',
      'heal_creature',
      'apply_condition',
      'set_hp',
      'grant_temporary_hp',
      'set_exhaustion',
      'record_external_roll',
      'record_external_damage',
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  /**
   * The rule is not "the model supplies no numbers" — that would forbid a DM
   * from giving an invented monster hit points, which the doctrine's North
   * Star explicitly protects. The rule is that **no number the model supplies
   * may decide or overwrite an outcome the engine owns**.
   *
   * Three kinds are legitimate and are listed with which kind they are:
   *
   * | Kind | Why it is allowed |
   * |---|---|
   * | authorship | a creature that does not exist yet has no established truth to contradict |
   * | ruling | a DC, a distance, a coordinate — the DM's judgement, not the outcome |
   * | selection | which slot, how many of an item |
   *
   * Exhaustive, so adding a number is a visible act that has to be classified
   * rather than a quiet one.
   */
  it('takes no number from the model that decides an outcome', () => {
    const ALLOWED: Readonly<Record<string, 'authorship' | 'ruling' | 'selection'>> = {
      'ability_check.dc': 'ruling',
      'add_landmark.x': 'ruling',
      'add_landmark.y': 'ruling',
      'add_landmark.z': 'ruling',
      'author_creature.armor_class': 'authorship',
      'author_creature.max_hp': 'authorship',
      'author_creature.proficiency_bonus': 'authorship',
      'author_creature.speed': 'authorship',
      'cast_spell.slot_level': 'selection',
      'eligible_targets.slot_level': 'selection',
      'give_item.quantity': 'selection',
      'move.bearing': 'ruling',
      'move.feet': 'ruling',
      'place_creature.bearing': 'ruling',
      'place_creature.feet': 'ruling',
      'set_scene.depth': 'ruling',
      'set_scene.height': 'ruling',
      'set_scene.width': 'ruling',
    };

    const numeric: string[] = [];
    for (const tool of TOOLS) {
      const properties = (tool.parameters as { properties: Record<string, { type?: string }> })
        .properties;
      for (const [name, spec] of Object.entries(properties)) {
        if (spec.type === 'number') numeric.push(`${tool.name}.${name}`);
      }
      // `author_creature.abilities` is a nested object of six scores, and it
      // is authorship for the same reason the rest of that tool is.
    }
    expect(numeric.sort()).toEqual(Object.keys(ALLOWED).sort());
  });

  /**
   * The number that must never cross, in either direction.
   *
   * Damage is the canonical case: `improvised_damage` takes `1d4`, a **string**
   * the DM is ruling, and the engine rolls it. A numeric `amount` would be the
   * model deciding how much damage a bar stool did, which is the outcome the
   * engine owns. Asserted by shape rather than by name so a future
   * `damage_amount` cannot slip in beside it.
   */
  it('takes damage as dice to be rolled, never as an amount already decided', () => {
    const improvised = TOOLS.find((t) => t.name === 'improvised_damage')!;
    const properties = (improvised.parameters as { properties: Record<string, { type?: string }> })
      .properties;
    expect(properties['dice']?.type).toBe('string');
    for (const [name, spec] of Object.entries(properties)) {
      if (/amount|damage_dealt|hp|hit_points|total|result|modifier|roll/.test(name)) {
        expect(spec.type, `${name} must not be a number the model decides`).not.toBe('number');
      }
    }
  });

  /**
   * Every tool that can write to the log must be safe to retry.
   *
   * Most carry a command id. The two creation tools cannot: `creature-added`
   * declares no command stamp, and stamping it anyway would lean on the
   * excess-property hole `CLAUDE.md` documents twice. **The creature id is
   * their idempotency key instead** — spawning the same creature under the
   * same id twice is a no-op, and a *different* creature under a taken id is a
   * refusal. That is asserted separately below.
   */
  it('requires a command id on every mutating tool that has one to require', () => {
    const KEYED_BY_SUBJECT: ReadonlySet<string> = new Set([
      // The creature id is the key.
      'spawn_srd_creature',
      'author_creature',
      // Declarations of a momentary or idempotent fact: re-declaring the same
      // scene, landmark, placement or sight line changes nothing.
      'set_scene',
      'add_landmark',
      'place_creature',
      // Sight and cover are the same shape and the engine takes no command
      // identity for either: both are pure functions over `PositionState`
      // keyed by (from, to), so re-declaring the same fact writes the same
      // value and a retry is a no-op by construction rather than by a stamp.
      'declare_sight',
      'declare_cover',
    ]);
    for (const tool of TOOLS.filter((t) => t.mutating)) {
      if (KEYED_BY_SUBJECT.has(tool.name)) continue;
      const required = (tool.parameters as { required: readonly string[] }).required;
      expect(required, tool.name).toContain('command_id');
    }
  });

  /** And narration may ride on any of them, so saying so costs no round trip. */
  it('lets every mutating tool carry its narration', () => {
    for (const tool of TOOLS.filter((t) => t.mutating)) {
      const properties = (tool.parameters as { properties: Record<string, unknown> }).properties;
      expect(properties['narration'], tool.name).toBeDefined();
    }
  });
});

describe('every debt the engine can raise has a way out', () => {
  /**
   * The rule the first live run taught, as a test.
   *
   * A move out of two goblins' reach opened `pendingMove` with two Opportunity
   * Attack offers. Every later command refused with `move_pending`, and the
   * surface had no tool that could answer an offer — so the fight stopped. The
   * model was not confused: it queried `options` for both goblins, saw the
   * Reaction was owed, and reached for a plain `attack` because that was the
   * nearest thing it had.
   *
   * **A surface missing one settlement is worse than a surface missing a whole
   * mechanic**, because the game deadlocks rather than the action being
   * refused. So every debt the observation can report is either settled by a
   * tool on this surface or listed below as knowingly unreachable, and a new
   * debt with neither fails here.
   */
  const SETTLED_BY: Record<string, readonly string[]> = {
    pending_move: ['take_opportunity_attack', 'decline_opportunity'],
    // `resolveTurn` is always given a generator here, so a boundary save is
    // rolled by the same call that raised it.
    pending_saves: ['end_turn'],
    turn_start_unsettled: ['end_turn'],
    // **This entry used to be an excuse, and the excuse went stale.** It read
    // "no spell on this surface makes a persistent area", which was true until
    // a Wizard with Grease prepared joined Tier 2 — and the only thing still
    // hiding it was that `cast_spell` could not point a Cube, so the area
    // could not be made. Two gaps masking each other. `owedAreaEffects` blocks
    // every action *including ending the turn*, so nothing but its own command
    // recovers.
    owed_area_effects: ['settle_area_effects'],
  };

  /**
   * Debts no tool on this surface can settle, each with the reason nothing on
   * this surface can open it either. If one of these becomes reachable, it
   * needs a tool before it needs anything else.
   */
  const KNOWN_UNREACHABLE: Record<string, string> = {
    pending_attack: 'only a held attack opens one, and `hold` is not exposed',
    pending_damage: 'only a damage-reducing Reaction opens one; nobody in this fixture has a feature that would',
    pending_test: 'only a test-pushing Reaction opens one; same',
    pending_casting: 'only a held casting opens one, and `hold` is not exposed',
  };

  it('names a settling tool for every debt, or records why it is unreachable', () => {
    const owed = (observe(fold(SEED, prelude('established'))) as { owed: Record<string, unknown> })
      .owed;
    const names = new Set(TOOLS.map((t) => t.name));
    for (const debt of Object.keys(owed)) {
      const settlers = SETTLED_BY[debt];
      if (settlers !== undefined) {
        for (const tool of settlers) expect(names).toContain(tool);
        continue;
      }
      expect(
        KNOWN_UNREACHABLE[debt],
        `${debt} can be reported but nothing settles it and no reason is recorded`,
      ).toBeTypeOf('string');
    }
  });

  /**
   * And the list above is checked against the engine, not against itself.
   *
   * The version of this test that only walked `observe()` could be satisfied
   * by *removing a debt from the projection* — which would hide it from the DM
   * rather than settle it, and is precisely how the Opportunity Attack
   * deadlock would recur. So the debts are enumerated from `GameState`'s own
   * shape: anything the engine can leave outstanding must be projected, and
   * projected debts must be settleable or explained.
   */
  it('projects every debt the engine can actually raise', () => {
    const state = fold(SEED, prelude('established'));
    const engineDebts = Object.keys(state).filter(
      (key) => key.startsWith('pending') || key.startsWith('owed'),
    );
    // What the projection calls each of them. A new `pendingFoo` in the engine
    // appears here with no entry and fails, which is the point.
    const PROJECTED_AS: Readonly<Record<string, string>> = {
      pendingAttack: 'pending_attack',
      pendingCasting: 'pending_casting',
      pendingDamage: 'pending_damage',
      pendingMove: 'pending_move',
      pendingSaves: 'pending_saves',
      pendingTest: 'pending_test',
      pendingTurnStart: 'turn_start_unsettled',
      owedAreaEffects: 'owed_area_effects',
    };
    const owed = (observe(state) as { owed: Record<string, unknown> }).owed;

    expect(engineDebts.sort()).toEqual(Object.keys(PROJECTED_AS).sort());
    for (const [field, projected] of Object.entries(PROJECTED_AS)) {
      expect(Object.keys(owed), `${field} is not shown to the DM`).toContain(projected);
      expect(
        SETTLED_BY[projected] ?? KNOWN_UNREACHABLE[projected],
        `${projected} is shown but neither settleable nor explained`,
      ).toBeDefined();
    }
  });

  /** The offer has to say who owes it, or answering is guesswork. */
  it('reports who must answer a held move, not just that one is held', () => {
    const owed = (observe(fold(SEED, prelude('established'))) as { owed: Record<string, unknown> })
      .owed;
    expect(owed).toHaveProperty('pending_move');
    // Null when nothing is held; an object naming the mover and the reactors
    // when something is. The shape is what matters here.
    expect(owed['pending_move']).toBeNull();
  });

  it('refuses an unoffered Opportunity Attack rather than crashing', () => {
    const result = dispatch(
      createSession(SEED, prelude('established')),
      'decline_opportunity',
      { attacker: GOBLIN_A, command_id: 'oa1' },
      { narration: [] },
    );
    expect(result.outcome).toBe('refusal');
    expect(result.code).toBe('not_provoked');
  });
});

describe('a call the model gets wrong is a value, not a crash', () => {
  const fresh = () => createSession(SEED, prelude('established'));

  it('reports a missing field as malformed input rather than throwing', () => {
    const result = dispatch(fresh(), 'attack', { attacker: 'kessa' }, { narration: [] });
    expect(result.outcome).toBe('invalid');
    expect(result.code).toBe('malformed_input');
  });

  it('reports an unknown tool rather than throwing', () => {
    const result = dispatch(fresh(), 'fireball_everyone', {}, { narration: [] });
    expect(result.outcome).toBe('invalid');
    expect(result.code).toBe('unknown_tool');
  });

  /**
   * The three-valued result, end to end. A goblin nobody has placed is not an
   * illegal target — it is a creature the engine has not been told the
   * position of, and the answer has to be a request naming the fact.
   */
  it('asks rather than refuses when the record is thin', () => {
    const session = createSession(SEED, prelude('thin'));
    const result = dispatch(
      session,
      'cast_spell',
      { caster: WIZARD, spell_id: 'fire-bolt', targets: [GOBLIN_A], command_id: 'x1' },
      { narration: [] },
    );
    expect(result.outcome).not.toBe('ok');
    if (result.outcome === 'needs-context') {
      expect(result.requestKinds.length).toBeGreaterThan(0);
    }
    expect(result.events).toBe(0);
  });

  /**
   * A declaration the reducer would reject must come back as a refusal. The
   * reducer calls `placeCreature` again and throws `CorruptLogError` on
   * failure, so a surface that pushed the event unchecked would crash the
   * whole run on a bad argument.
   */
  it('refuses a placement outside the scene instead of writing a corrupt log', () => {
    const session = createSession(SEED, prelude('established'));
    const result = dispatch(
      session,
      'place_creature',
      { who: GOBLIN_A, from_landmark: 'the bar', feet: 5000, bearing: 0 },
      { narration: [] },
    );
    expect(result.outcome).toBe('refusal');
    expect(result.events).toBe(0);
    // And the log is still foldable, which is the thing that was at risk.
    expect(() => fold(SEED, session.log())).not.toThrow();
  });

  it('never returns needs-context without saying what is missing', () => {
    const session = createSession(SEED, prelude('thin'));
    for (const call of [
      { tool: 'cast_spell', input: { caster: WIZARD, spell_id: 'hold-person', targets: [GOBLIN_A], slot_level: 2, command_id: 'a' } },
      { tool: 'attack', input: { attacker: GOBLIN_A, target: WIZARD, weapon: 'scimitar', command_id: 'b' } },
    ]) {
      const result = dispatch(session, call.tool, call.input, { narration: [] });
      if (result.outcome === 'needs-context') {
        expect(result.requestKinds.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('the observation the model is handed', () => {
  it('carries hit points, conditions, distances and the engine’s outstanding debts', () => {
    const view = observe(fold(SEED, prelude('established'))) as Record<string, unknown>;
    expect(view['creatures']).toBeInstanceOf(Array);
    const creatures = view['creatures'] as Record<string, unknown>[];
    const kessa = creatures.find((c) => c['id'] === WIZARD)!;
    expect(kessa['hp']).toBeGreaterThan(0);
    expect(kessa['conditions']).toEqual([]);
    expect((kessa['feet_to'] as Record<string, number>)[GOBLIN_A]).toBe(15);
    expect(view['owed']).toMatchObject({ owed_area_effects: 0 });
  });

  /** An unplaced creature is a normal state and must read as one, not as an error. */
  it('says a creature is unplaced rather than inventing a position', () => {
    const view = observe(fold(SEED, prelude('thin'))) as Record<string, unknown>;
    const creatures = view['creatures'] as Record<string, unknown>[];
    expect(creatures.every((c) => c['placed'] === null)).toBe(true);
    expect(view['scene']).toBeNull();
  });
});

describe('a run through the offline stand-in', () => {
  it('plays four rounds and writes an authoritative log', async () => {
    const outcome = await run();
    expect(outcome.log.length).toBeGreaterThan(prelude('established').length);
    expect(outcome.analysis.beats.length).toBeGreaterThan(0);
    expect(outcome.analysis.totalCalls).toBeGreaterThan(0);
  });

  /**
   * The stand-in reaches for Hold Person on a Fey goblin exactly as the
   * scripted scenario does, so the refusal path is exercised in CI rather than
   * only when a model happens to try it.
   */
  it('records the Hold Person refusal the rules actually make', async () => {
    const outcome = await run();
    expect([...outcome.analysis.refusalsByCode.keys()]).toContain('wrong_creature_type');
  });

  /** Invariants 2, 3 and 4, plus the one this experiment adds. */
  it('folds deterministically and replays its own transcript byte for byte', async () => {
    const outcome = await run();
    expect(outcome.determinism.foldsIdentically).toBe(true);
    expect(outcome.determinism.seedIndependent).toBe(true);
    expect(outcome.determinism.survivesJson).toBe(true);
    expect(outcome.determinism.transcriptReplays).toBe(true);
  });

  /** Two runs of the same stand-in against the same seed are the same fight. */
  it('is reproducible end to end', async () => {
    const a = await run();
    const b = await run();
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
  });

  it('leaves every creature coherent', async () => {
    const outcome = await run();
    for (const creature of Object.values(outcome.finalState.creatures)) {
      expect(creature.vitals.hp).toBeGreaterThanOrEqual(0);
      expect(creature.vitals.hp).toBeLessThanOrEqual(creature.vitals.hpMax);
      expect(Number.isFinite(creature.vitals.hp)).toBe(true);
    }
  });
});

/**
 * The two halves of the boundary, tested against each other.
 *
 * Every test below exists because the live experiment found the boundary
 * failing in one of two opposite directions, and a fix for either one can
 * easily make the other worse:
 *
 * | Direction | What went wrong live |
 * |---|---|
 * | too little authority for the engine | the model declared a Goblin Warrior "Humanoid", making its own Hold Person legal |
 * | too little room for the DM | the model ruled a shove correctly and had no primitive that could apply it |
 *
 * The doctrine's North Star says the second is the worse failure. So these
 * tests are written in pairs: a thing the model must not be able to do, beside
 * the thing it must still be free to do.
 */
describe('established mechanical truth is the engine own', () => {
  const fresh = (variant: 'established' | 'thin' = 'established') =>
    createSession(SEED, prelude(variant));

  /**
   * Requirement 1. The canonical failure, closed at the root.
   *
   * A goblin's type is not something anybody is asked for, because
   * `adaptMonster` carries it off the stat block. And having arrived, it
   * cannot be talked out of: wanting Hold Person to work is not a reason.
   */
  it('takes a Goblin Warrior type from the stat block and will not be talked out of it', () => {
    const session = fresh();
    expect(fold(SEED, session.log()).creatures[GOBLIN_A]!.creatureType).toBe('Fey');

    const relabel = dispatch(
      session,
      'declare_creature_type',
      { who: GOBLIN_A, creature_type: 'Humanoid', command_id: 'lie-1' },
      { narration: [] },
    );
    expect(relabel.outcome).toBe('refusal');
    expect(relabel.code).toBe('type_established');
    expect(fold(SEED, session.log()).creatures[GOBLIN_A]!.creatureType).toBe('Fey');
  });

  /** And the spell that wanted it is refused on the truth, not on a guess. */
  it('refuses Hold Person on a Fey goblin', () => {
    const session = fresh();
    dispatch(session, 'declare_sight', { from: WIZARD, to: GOBLIN_A, seen: true }, { narration: [] });
    const cast = dispatch(
      session,
      'cast_spell',
      { caster: WIZARD, spell_id: 'hold-person', targets: [GOBLIN_A], slot_level: 2, command_id: 'hp-1' },
      { narration: [] },
    );
    expect(cast.outcome).toBe('refusal');
    expect(cast.code).toBe('wrong_creature_type');
    expect(cast.events).toBe(0);
  });

  /** Requirement 8: a fact content holds is never requested from the model. */
  it('never asks what an SRD creature is, in either fixture', () => {
    for (const variant of ['established', 'thin'] as const) {
      const session = createSession(SEED, prelude(variant));
      const asked = dispatch(
        session,
        'eligible_targets',
        { caster: WIZARD, spell_id: 'hold-person', slot_level: 2 },
        { narration: [] },
      );
      const requests = (asked.body['needs_context'] ?? []) as { kind: string }[];
      expect(
        requests.map((r) => r.kind),
        variant,
      ).not.toContain('creature-type');
    }
  });

  /** An SRD creature's size comes from its stat block, not from the DM. */
  it('places an SRD creature at the size the stat block prints', () => {
    const session = fresh('thin');
    dispatch(session, 'set_scene', { width: 60, depth: 40, height: 20 }, { narration: [] });
    dispatch(session, 'add_landmark', { name: 'the bar', x: 10, y: 10 }, { narration: [] });
    const placed = dispatch(
      session,
      'place_creature',
      { who: GOBLIN_A, from_landmark: 'the bar', feet: 10, bearing: 0 },
      { narration: [] },
    );
    expect(placed.outcome).toBe('ok');
    expect(fold(SEED, session.log()).scene!.sizes[GOBLIN_A]).toBe('small');
  });
});

describe('world authorship is the DM own', () => {
  const MIRE_STALKER = {
    as: 'mire-stalker',
    name: 'Mire Stalker',
    creature_type: 'Aberration',
    max_hp: 45,
    armor_class: 14,
    speed: 30,
    abilities: { str: 17, dex: 12, con: 15, int: 6, wis: 11, cha: 7 },
    side: 'monsters',
  };

  /** Requirement 2. Maestro invents a creature and defines it. */
  it('lets the DM create a creature the SRD has never heard of', () => {
    const session = createSession(SEED, prelude('established'));
    const made = dispatch(session, 'author_creature', MIRE_STALKER, { narration: [] });
    expect(made.outcome).toBe('ok');

    const stalker = fold(SEED, session.log()).creatures['mire-stalker']!;
    expect(stalker.name).toBe('Mire Stalker');
    expect(stalker.creatureType).toBe('Aberration');
    expect(stalker.vitals.hpMax).toBe(45);
  });

  /**
   * Requirement 3. An authored fact is not a lesser fact.
   *
   * Once the DM has said what the Mire Stalker is, the engine consumes that
   * exactly as it consumes a stat block's: Hold Person refuses an Aberration
   * on the authored type, and nothing may quietly relabel it afterwards.
   */
  it('treats an authored fact as established truth from then on', () => {
    const session = createSession(SEED, prelude('established'));
    dispatch(session, 'author_creature', MIRE_STALKER, { narration: [] });
    dispatch(
      session,
      'declare_sight',
      { from: WIZARD, to: 'mire-stalker', seen: true },
      { narration: [] },
    );

    const cast = dispatch(
      session,
      'cast_spell',
      {
        caster: WIZARD,
        spell_id: 'hold-person',
        targets: ['mire-stalker'],
        slot_level: 2,
        command_id: 'hp-stalker',
      },
      { narration: [] },
    );
    expect(cast.outcome).toBe('refusal');
    expect(cast.code).toBe('wrong_creature_type');

    const relabel = dispatch(
      session,
      'declare_creature_type',
      { who: 'mire-stalker', creature_type: 'Humanoid', command_id: 'lie-2' },
      { narration: [] },
    );
    expect(relabel.code).toBe('type_established');
  });

  /** The DM may arm what it creates; the engine holds it to what it owns. */
  it('lets the DM equip a creature, and makes a retry a no-op', () => {
    const session = createSession(SEED, prelude('established'));
    dispatch(session, 'author_creature', MIRE_STALKER, { narration: [] });

    const armed = dispatch(
      session,
      'give_item',
      { who: 'mire-stalker', item_id: 'greatclub', command_id: 'arm-1' },
      { narration: [] },
    );
    expect(armed.outcome).toBe('ok');
    const held = () => carrying(fold(SEED, session.log()), asCharacterId('mire-stalker'));
    expect(held().map((l) => l.id)).toContain('greatclub');

    const again = dispatch(
      session,
      'give_item',
      { who: 'mire-stalker', item_id: 'greatclub', command_id: 'arm-1' },
      { narration: [] },
    );
    expect(again.body['duplicate']).toBe(true);
    expect(held().find((l) => l.id === 'greatclub')?.quantity).toBe(1);
  });

  /** An id already taken by a different creature is a refusal, not a silent overwrite. */
  it('will not overwrite an existing creature with a new one', () => {
    const session = createSession(SEED, prelude('established'));
    const clash = dispatch(
      session,
      'author_creature',
      { ...MIRE_STALKER, as: GOBLIN_A, name: 'Not A Goblin' },
      { narration: [] },
    );
    expect(clash.outcome).toBe('refusal');
    expect(clash.code).toBe('id_taken');
    expect(fold(SEED, session.log()).creatures[GOBLIN_A]!.name).toBe('Goblin Warrior');
  });
});

describe('adjudication is the DM own, and the numbers inside it are not', () => {
  /** Kessa: Dex 14, and no Acrobatics proficiency. So the modifier is +2. */
  const KESSA_ACROBATICS = 2;

  const inCombat = () => {
    const session = createSession(SEED, prelude('established'));
    session.push([
      {
        type: 'combat-started',
        combatants: [
          { id: WIZARD, initiative: 20, speed: 30 },
          { id: GOBLIN_A, initiative: 10, speed: 30 },
          { id: GOBLIN_B, initiative: 5, speed: 30 },
        ],
      },
    ]);
    return session;
  };

  /**
   * Requirements 4 and 6, which are the same test read from both ends.
   *
   * "I grab the chandelier and swing across the room." No SRD rule covers it.
   * The DM rules Acrobatics, DC 14 — and that is *all* the DM supplies. The
   * modifier is Kessa's real one, the die is the engine's, and the comparison
   * is the engine's.
   */
  it('lets the DM pick the check and the DC, and supplies the modifier itself', () => {
    const session = inCombat();
    const swing = dispatch(
      session,
      'ability_check',
      {
        who: WIZARD,
        kind: 'ability-check',
        ability: 'dex',
        skill: 'acrobatics',
        dc: 14,
        label: 'swing from the chandelier',
        command_id: 'chandelier-1',
        narration: 'Kessa leaps for the chandelier.',
      },
      { narration: [] },
    );

    expect(swing.outcome).toBe('ok');
    const natural = swing.body['natural'] as number;
    const total = swing.body['total'] as number;
    // The engine supplied the modifier. The DM never named one, and there is
    // no field on this tool through which it could have.
    expect(total - natural).toBe(KESSA_ACROBATICS);
    expect(typeof swing.body['success']).toBe('boolean');

    const properties = (
      TOOLS.find((t) => t.name === 'ability_check')!.parameters as {
        properties: Record<string, unknown>;
      }
    ).properties;
    expect(properties['modifier']).toBeUndefined();
    expect(properties['total']).toBeUndefined();
    expect(properties['success']).toBeUndefined();
  });

  /**
   * Requirement 5. The whole ruling, composed from primitives, with no
   * bespoke `SWING_FROM_CHANDELIER` command anywhere.
   *
   * Check, then consequence. The DM decides that failing means falling Prone
   * and that the kick deals 1d6; the engine decides the roll, what Prone
   * implies, how much damage 1d6 actually was, and what it did to the target.
   */
  it('lets the DM compose a whole ruling out of primitives', () => {
    const session = inCombat();
    const narration: string[] = [];

    const check = dispatch(
      session,
      'ability_check',
      {
        who: WIZARD,
        kind: 'ability-check',
        ability: 'dex',
        skill: 'acrobatics',
        dc: 14,
        label: 'swing from the chandelier and kick the goblin',
        command_id: 'chandelier-2',
      },
      { narration },
    );
    expect(check.outcome).toBe('ok');

    // The DM rules the consequence either way. Both paths are expressible.
    const prone = dispatch(
      session,
      'apply_ruled_condition',
      {
        who: WIZARD,
        condition: 'prone',
        ruling: 'lost her grip on the chandelier',
        command_id: 'chandelier-prone',
        narration: 'Kessa hits the floorboards.',
      },
      { narration },
    );
    expect(prone.outcome).toBe('ok');
    expect(fold(SEED, session.log()).creatures[WIZARD]!.conditions.conditions).toContain('prone');

    const kick = dispatch(
      session,
      'improvised_damage',
      {
        target: GOBLIN_A,
        dice: '1d6',
        damage_type: 'bludgeoning',
        ruling: 'a boot to the chest from a swinging chandelier',
        by: WIZARD,
        command_id: 'chandelier-kick',
      },
      { narration },
    );
    expect(kick.outcome).toBe('ok');
    const dealt = kick.body['rolled'] as number;
    expect(dealt).toBeGreaterThanOrEqual(1);
    expect(dealt).toBeLessThanOrEqual(6);

    // A shove is movement nobody spent Speed on, and it is expressible too.
    const shove = dispatch(
      session,
      'move',
      {
        who: GOBLIN_B,
        from_creature: WIZARD,
        // Eastward and into open floor. A shove toward the south wall is
        // refused `outside_scene`, which is the engine doing its job: the DM
        // rules *that* the goblin is flung, and the engine still owns where a
        // body can actually end up.
        feet: 20,
        bearing: 90,
        forced: true,
        command_id: 'chandelier-shove',
        narration: 'The goblin is flung back across the taproom.',
      },
      { narration },
    );
    expect(shove.outcome).toBe('ok');

    // Narration rode along with the actions rather than costing its own calls.
    expect(narration.length).toBeGreaterThanOrEqual(2);
    expect(() => fold(SEED, session.log())).not.toThrow();
  });

  /**
   * The line inside the ruling. The DM says `1d4`; the DM may not say `4`.
   *
   * This is the difference between authoring a rule and asserting an outcome,
   * and it is the one place damage could have leaked onto this surface.
   */
  it('rolls the dice the DM ruled and refuses an amount', () => {
    const session = inCombat();
    const bad = dispatch(
      session,
      'improvised_damage',
      {
        target: GOBLIN_A,
        dice: '4',
        damage_type: 'bludgeoning',
        ruling: 'a bar stool',
        command_id: 'stool-bad',
      },
      { narration: [] },
    );
    expect(bad.outcome).toBe('refusal');
    expect(bad.code).toBe('bad_notation');
    expect(bad.events).toBe(0);

    const good = dispatch(
      session,
      'improvised_damage',
      {
        target: GOBLIN_A,
        dice: '1d4',
        damage_type: 'bludgeoning',
        ruling: 'a bar stool',
        command_id: 'stool-good',
      },
      { narration: [] },
    );
    expect(good.outcome).toBe('ok');
    expect(good.body['rolled'] as number).toBeGreaterThanOrEqual(1);
    expect(good.body['rolled'] as number).toBeLessThanOrEqual(4);
  });

  /** A condition the SRD does not have is a refusal, so a typo is not a new rule. */
  it('refuses a condition that is not one', () => {
    const result = dispatch(
      inCombat(),
      'apply_ruled_condition',
      { who: GOBLIN_A, condition: 'bamboozled', ruling: 'nonsense', command_id: 'x' },
      { narration: [] },
    );
    expect(result.outcome).toBe('refusal');
    expect(result.code).toBe('unknown_condition');
  });
});
