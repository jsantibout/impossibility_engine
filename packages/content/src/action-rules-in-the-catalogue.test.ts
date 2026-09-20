import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet, SpellDefinition } from '@ie/engine';
import { createRng, type Rng } from '@ie/engine';
import { createRollIssuer } from '@ie/engine';
import { applyEvent, fold, type GameEvent, type GameState } from '@ie/engine';
import { hasCondition } from '@ie/engine';
import { spellSlotKey } from '@ie/engine';
import { declaredCasting } from '@ie/engine';
import {
  advanceTime,
  pendingCastingsOf,
  resolveDeclaredCast,
  resolveMove,
  resolveSpell,
  resolveTurn,
  settleAreaEffects,
  takeDash,
  takeDodge,
} from '@ie/engine';

/**
 * The catalogue's first four writers of `ActionRule`.
 *
 * `combat.ts` derived the ninth sourced grant from four SRD spells and the
 * catalogue wrote none of them: every entry the vocabulary reached was "a
 * spell nobody has written rather than a mechanic nobody has built", and
 * `action-rules.test.ts` had to transcribe Stinking Cloud, Wind Walk, Fear and
 * Magic Jar into homebrew to drive the reader at all. These are the
 * definitions.
 *
 * | Spell | SRD | What it writes |
 * |---|---|---|
 * | Stinking Cloud | "While Poisoned in this way, the creature can't take an action or a Bonus Action." | a `forbids` rider on the trigger's save |
 * | Fear | "A Frightened creature takes the Dash action" | a `permits-only` rider on the save |
 * | Wind Walk | "The only actions a target can take in this form are the Dash action or a Magic action" | a standalone `permits-only` |
 * | Magic Jar | "You can't move or take Reactions. The only action you can take is to project your soul" | a standalone `forbids` **and** a `permits-only` |
 *
 * **A rule is asserted as a refusal or an allowance a caller can see**, never
 * as a flag in the state: `takeDodge` comes back `action_forbidden` with the
 * spell's name and the moment it ends, and `takeDash` lands, action and all.
 * A rule nobody could be refused by is a sentence that validates, loads and
 * does nothing, which is the failure the whole of `missing-shapes.ts` is about.
 *
 * **The engine does not play creatures.** Fear's compulsion is written as the
 * legality it is — the Action slot narrowed to Dash — and whether anybody runs
 * is the table's. See {@link ActionRule} in `combat.ts`, where that argument
 * lives beside the code.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WIZARD = id('wizard');
const FOE = id('foe');
const OGRE = id('ogre');
const ALLY = id('ally');

/** A Wisdom and a Constitution of 1 fail every save these spells ask for. */
const FRAIL = { str: 10, dex: 10, con: 1, int: 10, wis: 1, cha: 10 } as const;

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 12, con: 14, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 80,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

/**
 * The room, in one line: the caster at the door, the foe ten feet north of
 * him and inside a 30-foot Cone, the ogre sixty feet north where a 20-foot
 * Sphere reaches neither of the others, and the ally in the alcove behind.
 */
const NORTH = { x: 50, y: 100, z: 0 } as const;
const WELL = { x: 50, y: 110, z: 0 } as const;

const PLACED: readonly GameEvent[] = [
  added(WIZARD),
  added(FOE, { abilities: FRAIL }),
  added(OGRE, { abilities: FRAIL }),
  added(ALLY),
  ...[1, 2, 3, 4, 5, 6].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WIZARD,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 4,
        recovers: 'long-rest',
      },
    }),
  ),
  // The ogre casts too, because a Bonus Action has no other spender in this
  // engine that a caller can reach — and "can't take an action **or a Bonus
  // Action**" is two slots rather than one.
  {
    type: 'resource-pool-declared',
    id: OGRE,
    pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 2, recovers: 'long-rest' },
  },
  {
    type: 'spellcasting-declared',
    id: OGRE,
    spellcasting: declaredCasting({ ability: 'cha', cantrips: [], prepared: ['healing-word'] }),
  },
  {
    type: 'resource-pool-declared',
    id: ALLY,
    pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 2, recovers: 'long-rest' },
  },
  {
    type: 'spellcasting-declared',
    id: ALLY,
    spellcasting: declaredCasting({ ability: 'wis', cantrips: [], prepared: ['cure-wounds'] }),
  },
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      cantrips: [],
      prepared: ['fear', 'stinking-cloud', 'wind-walk', 'magic-jar'],
    }),
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the door', at: { x: 50, y: 50, z: 0 } },
  { type: 'landmark-added', name: 'the pillar', at: { x: 50, y: 60, z: 0 } },
  { type: 'landmark-added', name: 'the well', at: WELL },
  { type: 'landmark-added', name: 'the alcove', at: { x: 50, y: 40, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the door' }, feet: 0 } },
  { type: 'creature-placed', id: FOE, placement: { from: { landmark: 'the pillar' }, feet: 0 } },
  { type: 'creature-placed', id: OGRE, placement: { from: { landmark: 'the well' }, feet: 0 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { landmark: 'the alcove' }, feet: 0 } },
  { type: 'sight-declared', from: WIZARD, to: FOE, seen: true },
  { type: 'sight-declared', from: WIZARD, to: OGRE, seen: true },
  { type: 'sight-declared', from: WIZARD, to: ALLY, seen: true },
];

/** The caster acts first, so a victim's own turn is a whole slot of the order away. */
const FIGHTING: readonly GameEvent[] = [
  ...PLACED,
  {
    type: 'combat-started',
    combatants: [
      { id: WIZARD, initiative: 20, speed: 30 },
      { id: FOE, initiative: 10, speed: 30 },
      { id: OGRE, initiative: 8, speed: 30 },
      { id: ALLY, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (seed = 'cast') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>): T => unwrap(result, 'action rules');

const defined = (spellId: string): SpellDefinition => {
  const definition = SRD_CONTENT.spell(spellId);
  if (definition === null) throw new Error(`${spellId} has no definition`);
  return definition;
};

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

/**
 * Cast a spell out of the catalogue, settling a rite of a minute or more.
 *
 * Wind Walk and Magic Jar both print "Casting Time: 1 minute", so
 * `resolveSpell` declares them and the clock has to arrive before anything
 * lands — the same two steps `long-casting-spells.test.ts` drives the tracked
 * twelve through.
 */
const castFrom = (
  log: readonly GameEvent[],
  spellId: string,
  request: Record<string, unknown> = {},
): readonly GameEvent[] => {
  const definition = defined(spellId);
  const first = must(
    resolveSpell(
      state(log),
      WIZARD,
      { spellId, targets: [], slotLevel: definition.level, ...request },
      supply(spellId),
    ),
  ).events;
  if (definition.castingTime !== 'long') return first;

  const open = state([...log, ...first]);
  const castingId = pendingCastingsOf(open)[0]!.castingId;
  const tick = must(advanceTime(open, definition.castingSeconds!, 'the rite'));
  const settled = must(
    resolveDeclaredCast(state([...log, ...first, ...tick]), castingId, supply(spellId)),
  );
  return [...first, ...tick, ...settled.events];
};

const whoseTurn = (world: GameState): CharacterId | undefined =>
  world.combat?.order[world.combat.turnIndex]?.id;

/** Advance to whoever is next, settling whatever the boundary owes. */
const nextTurn = (log: readonly GameEvent[]): readonly GameEvent[] => [
  ...log,
  ...must(resolveTurn(state(log), supply('turn'))).events,
];

/** Wind the order round to the named creature's turn. */
const turnOf = (log: readonly GameEvent[], who: CharacterId): readonly GameEvent[] => {
  let current = log;
  for (let i = 0; i < 8; i += 1) {
    if (whoseTurn(state(current)) === who) return current;
    current = nextTurn(current);
  }
  throw new Error(`the order never reached ${who}`);
};

/**
 * Settle what the areas owe, which the turn boundary raises and does not pay.
 *
 * `resolveTurn` refuses to carry the order past a debt — "settling them can
 * change the world anybody else would act into" — so a creature standing in
 * the gas at the top of its turn owes a Constitution save that somebody has
 * to call for. The same two steps `area-triggers.test.ts` drives every area
 * through.
 */
const settleAreas = (log: readonly GameEvent[]): readonly GameEvent[] => [
  ...log,
  ...must(settleAreaEffects(state(log), supply('settle'))).events,
];

const rulesOn = (world: GameState, who: CharacterId) => world.creatures[who]?.actionRules ?? [];

const refusal = (result: Result<unknown>): string => {
  expect(isErr(result)).toBe(true);
  if (!isErr(result)) throw new Error('not a refusal');
  expect(result.code).toBe('action_forbidden');
  return result.reason;
};

/**
 * Every prefix of the log folds, and folding the whole is the same as stepping
 * it event by event — the determinism claim, over a log that now carries an
 * `action-rule-granted` in the middle of it.
 */
const replaysPrefixByPrefix = (log: readonly GameEvent[]): void => {
  for (let n = 0; n <= log.length; n += 1) {
    const whole = state(log.slice(0, n));
    const stepped = log.slice(0, n).reduce(applyEvent, state([]));
    expect(stepped).toEqual(whole);
  }
};

// — Stinking Cloud ————————————————————————————————————————————————————————

/**
 * SRD Stinking Cloud, the sentence the definition used to file as debt:
 *
 * > "Each creature that starts its turn in the Sphere must succeed on a
 * > Constitution saving throw or have the Poisoned condition until the end of
 * > the current turn. **While Poisoned in this way, the creature can't take an
 * > action or a Bonus Action.**"
 *
 * One save, a condition and a restriction, so the restriction is a **rider**
 * on the outcome the save already settled: a second effect would roll a second
 * saving throw for one sentence. Its `lasts` is the Poisoned's own
 * `end-of-current-turn`, because the clause is about the turn the boundary
 * fired at and the casting's minute would go on gagging somebody for the rest
 * of the fight.
 */
describe('Stinking Cloud forbids the action and the Bonus Action it printed', () => {
  const poisoned = (): readonly GameEvent[] => {
    const cast = castFrom(PLACED, 'stinking-cloud', { at: WELL });
    return settleAreas(turnOf([...PLACED, ...cast, ...FIGHTING.slice(PLACED.length)], OGRE));
  };

  it('writes the rider the book prints, and drops the clause that filed it as debt', () => {
    const cloud = defined('stinking-cloud');
    const save = cloud.areaTrigger?.effects[0];
    expect(save?.kind).toBe('save');
    expect(save?.kind === 'save' ? save.modifiers : undefined).toEqual([
      {
        kind: 'action',
        rule: { kind: 'forbids', slots: ['action', 'bonus-action'] },
        lasts: 'end-of-current-turn',
      },
    ]);
    expect(cloud.unmodelled).toEqual([
      'the cloud is Heavily Obscured, and obscurement is not modelled',
      'a strong wind dispersing the cloud, which is a fact about the weather rather than a consequence the engine records',
    ]);
  });

  it('refuses the Action of a creature that started its turn in the gas', () => {
    const log = poisoned();
    const world = state(log);
    expect(hasCondition(world.creatures[OGRE]!.conditions, 'poisoned')).toBe(true);

    const rules = rulesOn(world, OGRE);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.source).toMatch(/^Stinking Cloud#cast:/);
    expect(rules[0]?.label).toBe('Stinking Cloud');

    const said = refusal(takeDodge(world, OGRE, {}));
    expect(said).toContain('Stinking Cloud');
    expect(said).toContain('the end of the current turn');
  });

  /**
   * The other slot the same sentence names, which is not the same slot.
   *
   * SRD says "an action **or a Bonus Action**", and a rule that forbade only
   * the first would pass every assertion above. The Bonus Action has one
   * spender a caller can reach — a casting that costs one — so that is what
   * is refused here.
   */
  it('refuses the Bonus Action the same sentence takes away', () => {
    const world = state(poisoned());
    const said = refusal(
      resolveSpell(
        world,
        OGRE,
        { spellId: 'healing-word', targets: [OGRE], slotLevel: 1 },
        supply('word'),
      ),
    );
    expect(said).toContain('a Bonus Action');
    expect(said).toContain('Stinking Cloud');
  });

  /**
   * And the gas takes only what the sentence names. "Can't take an action or a
   * Bonus Action" says nothing about moving, and a creature that could not
   * walk out of a cloud it is standing in would be a rule the book never
   * printed.
   */
  it('leaves the movement the sentence says nothing about', () => {
    const log = poisoned();
    const moved = resolveMove(
      state(log),
      OGRE,
      { placement: { from: { landmark: 'the door' }, feet: 40, bearing: 0 } },
      supply('walk'),
    );
    expect(isErr(moved)).toBe(false);
  });

  it('replays prefix by prefix', () => {
    replaysPrefixByPrefix(poisoned());
  });
});

// — Fear ——————————————————————————————————————————————————————————————————

/**
 * SRD Fear:
 *
 * > "A Frightened creature takes the Dash action and moves away from you by
 * > the safest route on each of its turns unless there is nowhere to move."
 *
 * Written as the legality it is — the Action slot narrowed to Dash, failing
 * closed — because a compulsion the engine executed would be the engine
 * playing a creature. "Unless there is nowhere to move" is a fact about the
 * room and stays the table's.
 */
describe('Fear narrows a Frightened creature’s Action to the Dash', () => {
  const frightened = (): readonly GameEvent[] => {
    const cast = castFrom(FIGHTING, 'fear', { towards: NORTH });
    return turnOf([...FIGHTING, ...cast], FOE);
  };

  it('writes the rider the book prints, and keeps the two clauses it does not', () => {
    const fear = defined('fear');
    const save = fear.effects[0];
    expect(save?.kind === 'save' ? save.modifiers : undefined).toEqual([
      { kind: 'action', rule: { kind: 'permits-only', slot: 'action', actions: ['dash'] } },
    ]);
    expect(fear.unmodelled).toEqual([
      'a creature that fails drops whatever it is holding',
      'the Dash away from you by the safest route, and the "unless there is nowhere to move" it stops at, are the DM’s: the engine narrows the Action to the Dash and moves nobody',
      'the Wisdom save a Frightened creature makes when it ends its turn out of your line of sight, which would end the spell on that creature',
    ]);
  });

  it('refuses every other Action, naming the spell and the moment it ends', () => {
    const world = state(frightened());
    expect(hasCondition(world.creatures[FOE]!.conditions, 'frightened')).toBe(true);

    const said = refusal(takeDodge(world, FOE, {}));
    expect(said).toContain('Fear permits only Dash');
    expect(said).toContain('the spell ends');
  });

  /** And the Dash itself lands, action and all: a narrowing is not a silence. */
  it('lets the Dash through', () => {
    const world = state(frightened());
    const dashed = must(takeDash(world, FOE, {}));
    expect(dashed.some((e) => e.type === 'action-spent')).toBe(true);
  });

  /** A creature the cone never caught is untouched. */
  it('leaves a creature outside the Cone alone', () => {
    const world = state(frightened());
    expect(rulesOn(world, ALLY)).toEqual([]);
  });

  it('replays prefix by prefix', () => {
    replaysPrefixByPrefix(frightened());
  });
});

// — Wind Walk —————————————————————————————————————————————————————————————

/**
 * SRD Wind Walk:
 *
 * > "The only actions a target can take in this form are the Dash action or a
 * > Magic action to begin reverting to its normal form."
 *
 * A standalone `action-rule`, because the book asks for no roll — the shape
 * `armor-class`, `damage-defense` and `speed` already take. It fails closed,
 * so a cloud may not Attack, and "to begin reverting" is the narrowing inside
 * the Magic action that the engine cannot tell apart and says so.
 */
describe('Wind Walk narrows a cloud to the two actions the book leaves it', () => {
  const walking = (): readonly GameEvent[] => {
    const cast = castFrom(PLACED, 'wind-walk', { targets: [ALLY] });
    return turnOf([...PLACED, ...cast, ...FIGHTING.slice(PLACED.length)], ALLY);
  };

  it('writes the standalone rule the book prints', () => {
    const walk = defined('wind-walk');
    expect(walk.effects).toEqual([
      {
        kind: 'action-rule',
        rule: { kind: 'permits-only', slot: 'action', actions: ['dash', 'magic'] },
      },
    ]);
    expect(walk.targets.self).toBe(true);
  });

  it('refuses the Attack and the Dodge a cloud may not take', () => {
    const world = state(walking());
    const said = refusal(takeDodge(world, ALLY, {}));
    expect(said).toContain('Wind Walk permits only Dash or Magic');
  });

  it('lets the Dash through, for the eight hours the spell runs', () => {
    const world = state(walking());
    expect(must(takeDash(world, ALLY, {})).some((e) => e.type === 'action-spent')).toBe(true);
  });

  /**
   * And the Magic action beside it, which is the half a narrowing to `['dash']`
   * alone would have refused: a cloud may act to begin reverting, and a casting
   * out of the Action slot is the one Magic action this engine can be asked
   * for. Cure Wounds rather than the Bonus Action spell above, because the
   * slot this rule narrows is the Action.
   */
  it('lets the Magic action through', () => {
    const world = state(walking());
    const out = must(
      resolveSpell(
        world,
        ALLY,
        { spellId: 'cure-wounds', targets: [ALLY], slotLevel: 1 },
        supply('revert'),
      ),
    );
    expect(out.events.some((e) => e.type === 'spell-cast')).toBe(true);
  });

  it('replays prefix by prefix', () => {
    replaysPrefixByPrefix(walking());
  });
});

// — Magic Jar —————————————————————————————————————————————————————————————

/**
 * SRD Magic Jar:
 *
 * > "Your body falls into a catatonic state as your soul leaves it … **You
 * > can't move or take Reactions. The only action you can take is to project
 * > your soul** up to 100 feet out of the container."
 *
 * Two rules out of one entry, which is the pair `actionRuleKey` was written
 * for: keyed by the source alone the second would evict the first and the
 * paragraph would lose half of itself. "Project your soul" is no action a
 * spender can tell apart, so the narrowed slot names **nothing** — every
 * action the engine can name is refused and the one the book permits is one it
 * could never have offered.
 */
describe('Magic Jar leaves a catatonic body two rules rather than one', () => {
  const catatonic = (): readonly GameEvent[] => [
    ...PLACED,
    ...castFrom(PLACED, 'magic-jar', { targets: [WIZARD] }),
  ];

  it('writes both rules the one entry prints', () => {
    expect(defined('magic-jar').effects).toEqual([
      { kind: 'action-rule', rule: { kind: 'forbids', slots: ['movement', 'reaction'] } },
      { kind: 'action-rule', rule: { kind: 'permits-only', slot: 'action', actions: [] } },
    ]);
  });

  it('keeps both of them on the caster, rather than the second evicting the first', () => {
    const rules = rulesOn(state(catatonic()), WIZARD);
    expect(rules.map((held) => held.rule.kind).sort()).toEqual(['forbids', 'permits-only']);
    expect(rules.every((held) => held.label === 'Magic Jar')).toBe(true);
  });

  it('refuses the body’s movement', () => {
    const log = turnOf([...catatonic(), ...FIGHTING.slice(PLACED.length)], WIZARD);
    const said = refusal(
      resolveMove(
        state(log),
        WIZARD,
        { placement: { from: { landmark: 'the pillar' }, feet: 5, bearing: 0 } },
        supply('walk'),
      ),
    );
    expect(said).toContain('Magic Jar forbids it');
  });

  it('refuses every action it can name', () => {
    const log = turnOf([...catatonic(), ...FIGHTING.slice(PLACED.length)], WIZARD);
    expect(refusal(takeDodge(state(log), WIZARD, {}))).toContain('permits only nothing at all');
    expect(refusal(takeDash(state(log), WIZARD, {}))).toContain('permits only nothing at all');
  });

  it('replays prefix by prefix', () => {
    replaysPrefixByPrefix(catatonic());
  });
});
