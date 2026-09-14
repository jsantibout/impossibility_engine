import { describe, expect, it } from 'vitest';
import { declaredCasting } from './spellcasting.js';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { resolveSpell } from './commands.js';
import {
  SPELL_DEFINITIONS,
  definitionFor,
  riderDurations,
  statesFoughtFact,
  teleportOf,
} from './spell-definitions.js';

/**
 * The spells poured into the shapes, driven rather than inspected.
 *
 * `coverage.test.ts` already asserts every definition against the parsed book
 * for name, level, school, casting time and Concentration — that catches a
 * transcription slip. What it cannot catch is a definition that is internally
 * fine and does nothing useful when cast, so this drives a representative one
 * of each shape through `resolveSpell` and checks the state moved.
 *
 * It also holds the rule that makes the whole batch honest: **a definition
 * that leaves part of its spell out must say so at runtime**, not only in a
 * docstring nobody at the table will read.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const TARGET = id('target');
const BYSTANDER = id('bystander');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 20,
  abilities: { str: 10, dex: 10, con: 10, int: 20, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId, creatureType = 'Humanoid'): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 500,
  diesAtZero: false,
  creatureType,
});

/** Every slot level, so any spell in the catalogue can actually be paid for. */
const slots: GameEvent[] = Array.from({ length: 9 }, (_, i) => ({
  type: 'resource-pool-declared',
  id: CASTER,
  pool: {
    key: spellSlotKey(i + 1),
    label: `level ${i + 1} spell slot`,
    max: 4,
    recovers: 'long-rest',
  },
}));

/**
 * The table, with the target and bystander being whatever kind of creature
 * a spell demands. A type is durable — the engine refuses a declaration that
 * rewrites one — so a fixture says what a creature is when it adds it.
 */
const setupWith = (targetType: string): readonly GameEvent[] => [
  added(CASTER),
  added(TARGET, targetType),
  added(BYSTANDER, targetType),
  ...slots,
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'here', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'here' }, feet: 0 } },
  { type: 'creature-placed', id: TARGET, placement: { from: { creature: CASTER }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: BYSTANDER, placement: { from: { creature: CASTER }, feet: 200, bearing: 90 } },
  { type: 'sight-declared', from: CASTER, to: TARGET, seen: true },
  { type: 'sight-declared', from: CASTER, to: BYSTANDER, seen: true },
  {
    type: 'spellcasting-declared',
    id: CASTER,
    // A creature that knows the whole catalogue, so any definition can be
    // driven without inventing a class that happens to have it.
    spellcasting: declaredCasting({
      ability: 'int',
      cantrips: SPELL_DEFINITIONS.filter((d) => d.level === 0).map((d) => d.id),
      prepared: SPELL_DEFINITIONS.filter((d) => d.level > 0).map((d) => d.id),
    }),
  },
];

const SETUP: readonly GameEvent[] = setupWith('Humanoid');

const base = (): GameState => fold('seed', SETUP);

const supply = (seed: string, bonus: number) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  bonuses: [{ source: 'forced', flat: bonus }],
});

/**
 * A log whose target is whatever kind of creature this spell demands.
 *
 * Animal Friendship wants a Beast and Charm Person wants a Humanoid, and the
 * type check is real — refusing the wrong type is the behaviour, not an
 * obstacle. So the fixture says what the target is rather than the spell being
 * excused the check.
 */
const logFor = (spellId: string): readonly GameEvent[] => {
  const definition = definitionFor(spellId);
  const wanted = definition?.targets.mustBeType;

  const typed: readonly GameEvent[] = wanted === undefined ? SETUP : setupWith(wanted);

  // A rider that ends at a moment in the turn order needs there to *be* turns.
  // SRD gives "until the end of your next turn" no meaning outside combat and
  // the engine refuses rather than inventing six seconds, so a spell carrying
  // one is driven in a fight. Not an excuse for the spell: the refusal is
  // asserted on its own in `turn-anchored-riders.test.ts`.
  //
  // **Which effects carry one is `riderDurations`' answer, not this file's.**
  // The kinds were enumerated by hand here, and that list is the thing the
  // command layer already derives — so it could disagree, and did, twice over.
  // It named `save`, `attack` and `save-damage` and not `condition`, which has
  // carried a rider since the standalone kind landed; and it read one rider
  // per effect, so it went blind the day a host learned to carry several and
  // a spell whose *second* condition was turn-anchored would have been driven
  // outside combat and refused. Either way the refusal would have been the
  // fixture's rather than the spell's.
  //
  // **A span of seconds needs no turns**, so the question is which kind of
  // deadline rather than whether there is one: `RiderDuration`'s two string
  // members are the turn-anchored pair, and Sunburst's `{ seconds: 60 }` is
  // the third and wants no fight to be happening.
  const anchored =
    definition?.durationUntil !== undefined ||
    (definition !== null &&
      riderDurations(definition).some((lasts) => typeof lasts === 'string'));

  // A Reaction is cast in answer to something, and the engine now checks that
  // the something happened. Same principle as the creature type above: the
  // fixture supplies the moment the spell needs rather than the spell being
  // excused its own casting time. The refusal is asserted on its own in
  // `reaction-triggers.test.ts`.
  const triggered: readonly GameEvent[] =
    definition?.trigger === 'hit-by-attack'
      ? [
          {
            type: 'attack-landed',
            attack: {
              attacker: TARGET,
              target: CASTER,
              weapon: null,
              twoHanded: false,
              thrown: false,
              critical: false,
              ability: 'str',
              targetAc: 10,
              // High enough that no bonus this fixture grants turns it aside,
              // so the spell under test is the casting rather than the
              // deflection.
              total: 40,
              natural: 19,
            },
          },
        ]
      : definition?.trigger === 'damaged-by-creature'
        ? // Damage dealt by the creature the fixture goes on to cast at, since
          // "the creature that damaged you" is a forced target rather than a
          // choice.
          [{ type: 'damage-taken', id: CASTER, amount: 4, source: 'a blade', by: TARGET }]
        : definition?.trigger === 'casting-a-spell'
          ? // A casting held open by the creature the fixture casts at, since
            // "a creature in the process of casting a spell" is likewise a
            // forced target. Written straight into the log rather than driven
            // through `resolveSpell`, so the fixture states the moment rather
            // than depending on another spell's rules to produce it.
            ([
              {
                type: 'spell-declared',
                casting: {
                  castingId: 'cast:1',
                  caster: TARGET,
                  spellId: 'fire-bolt',
                  spell: 'Fire Bolt',
                  level: 0,
                  slot: null,
                  slotless: 'cantrip',
                  castingTime: 'action',
                  concentration: false,
                  targets: [BYSTANDER],
                  unverified: [],
                },
              },
            ] as readonly GameEvent[])
          : [];

  if (!anchored && triggered.length === 0) return typed;

  return [
    ...typed,
    ...(anchored
      ? ([
          {
            type: 'combat-started',
            combatants: [
              { id: CASTER, initiative: 20, speed: 30 },
              { id: TARGET, initiative: 10, speed: 30 },
              { id: BYSTANDER, initiative: 5, speed: 30 },
            ],
          },
        ] as readonly GameEvent[])
      : []),
    ...triggered,
  ];
};

/** Cast at whatever the definition needs: a target, or a place. */
const castAt = (
  state: GameState,
  spellId: string,
  bonus: number,
  seed = 'cast',
): ReturnType<typeof resolveSpell> => {
  const definition = definitionFor(spellId);
  if (definition === null) throw new Error(`${spellId} has no definition`);

  const slotLevel = definition.level === 0 ? undefined : definition.level;
  const towards = { x: 100, y: 200, z: 0 };
  // A spell that prints two damage types and picks between them on a fact
  // about its caster is refused until the caster's layer says which — see
  // `SpellDefinition.damageTypeStated`. The sweep states the first, because
  // the point here is that every definition casts, not which type it dealt.
  //
  // The second stated fact is the same shape: SRD Charm Person gives a target's
  // save Advantage "if you or your allies are fighting **it**", the engine
  // holds no such fact, and a casting that says nothing is refused. The sweep
  // answers with the **empty list** — "none of them" — because a fought target
  // rolls two dice and the point here is that every definition casts rather
  // than how a save came out. That is also the case that would break if the
  // empty list were ever elided the way a designation is, so this fixture is
  // the one that would notice. `statesFoughtFact` is the runtime's own reader
  // rather than a second reading of the field — the lesson `riderDurations`
  // taught this file.
  //
  // The third is a teleport's destination, and it is the same shape a third
  // time: a spell that teleports is refused until the caster names a space,
  // and a spell that teleports nobody is refused for naming one. The sweep
  // answers with a **landmark** ten feet from where everyone is standing —
  // inside the scene, unoccupied, and within the shortest teleport in the
  // catalogue. `teleportOf` is the runtime's own reader, for the reason
  // `statesFoughtFact` is used above rather than a second reading of the field.
  const stated = {
    ...(definition.damageTypeStated === undefined
      ? {}
      : { damageType: definition.damageTypeStated[0]! }),
    ...(statesFoughtFact(definition) ? { fought: [] as readonly CharacterId[] } : {}),
    ...(teleportOf(definition) === null
      ? {}
      : { teleportTo: { from: { landmark: 'here' }, feet: 10, bearing: 180 } }),
  };
  // The caster's own square. Deliberate: a Cube or Cone excludes its point of
  // origin, so an area placed *on* the target would leave them out of it —
  // correct by the rules, and a fixture that looked like a broken spell.
  const at = { x: 100, y: 100, z: 0 };

  if (definition.area === undefined) {
    // A spell that aims at nobody gets nobody: Detect Magic has no target and
    // passing one is a refusal, not a courtesy.
    const aimsAtNobody =
      definition.targets.count === 0 && definition.targets.unlimited !== true;
    const targets = aimsAtNobody ? [] : [TARGET];
    // A bounded target list takes both halves: the names, and the point whose
    // area bounds them. Centred on the caster, who has everyone in reach.
    //
    // A casting that holds an `origin` takes a point for a different reason —
    // it is what the spell then measures from, not a bound on a choice — but
    // the same square serves: the caster's own is five feet from TARGET, which
    // is the reach Spiritual Weapon's force has.
    const placed =
      definition.targetsWithin !== undefined || definition.origin !== undefined ? { at } : {};
    return resolveSpell(
      state,
      CASTER,
      { spellId, targets, ...placed, ...stated, ...(slotLevel === undefined ? {} : { slotLevel }) },
      supply(seed, bonus),
    );
  }

  const directional = ['cone', 'cube', 'line'].includes(definition.area.kind);
  return resolveSpell(
    state,
    CASTER,
    {
      spellId,
      targets: [],
      ...(definition.area.origin === 'point' ? { at } : {}),
      ...(directional ? { towards } : {}),
      ...stated,
      ...(slotLevel === undefined ? {} : { slotLevel }),
    },
    supply(seed, bonus),
  );
};

/**
 * A spell cast on an attack that has hit is not cast through this command at
 * all — SRD Divine Smite's casting time is "immediately after hitting a
 * target", and `resolveSpell` has no attack to hand it. They are driven by
 * `smite.test.ts` instead, and the refusal here is asserted rather than the
 * spell being quietly left out of the sweep.
 */
const ON_HIT = SPELL_DEFINITIONS.filter((d) =>
  d.effects.some((effect) => effect.kind === 'attack-damage'),
);
const CASTABLE = SPELL_DEFINITIONS.filter((d) => !ON_HIT.includes(d));

describe('a spell cast on a hit is refused by the ordinary casting command', () => {
  it('has some, so the rule below is not vacuous', () => {
    expect(ON_HIT.length).toBeGreaterThan(0);
  });

  it.each(ON_HIT.map((d) => [d.id] as const))('refuses %s, and says why', (spellId) => {
    const out = castAt(fold('seed', logFor(spellId)), spellId, -40);
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('cast_on_a_hit');
  });
});

describe('every definition in the catalogue actually casts', () => {
  it.each(CASTABLE.map((d) => [d.id] as const))('resolves %s', (spellId) => {
    // A failed save for anything that allows one, so the interesting branch is
    // the one that runs.
    const out = unwrap(castAt(fold('seed', logFor(spellId)), spellId, -40), spellId);
    expect(out.castingId.length).toBeGreaterThan(0);

    expect(out.events.length).toBeGreaterThan(0);

    // Something happened to somebody: a spell that resolves to nothing at all
    // is a definition that compiles and does not work. A **tracked** spell is
    // the deliberate exception — it resolves to a casting and nothing else —
    // and it owes the stronger obligation instead: it must say what the DM is
    // being left to do, or it is a definition that quietly does nothing.
    const definition = definitionFor(spellId)!;
    if (definition.effects.length === 0 && definition.areaTrigger !== undefined) {
      // The third case, and it is a spell rather than a stub: SRD Web's webs
      // simply appear, and every save Web ever calls for comes from a creature
      // starting its turn in them or walking into them. A casting that
      // resolves nothing here is correct; the trigger is where the spell is.
      expect(out.outcomes).toEqual([]);
    } else if (definition.effects.length === 0) {
      expect(out.outcomes).toEqual([]);
      expect(out.unverified.length).toBeGreaterThan(0);
    } else {
      expect(out.outcomes.length).toBeGreaterThan(0);
    }
  });

  it.each(CASTABLE.map((d) => [d.id] as const))('spends exactly one casting for %s', (spellId) => {
    const out = unwrap(castAt(fold('seed', logFor(spellId)), spellId, -40), spellId);
    expect(out.events.filter((e) => e.type === 'spell-cast')).toHaveLength(1);
  });

  /** Same state, same seed, same batch — twice. */
  it.each(CASTABLE.map((d) => [d.id] as const))('is deterministic for %s', (spellId) => {
    const log = logFor(spellId);
    const first = unwrap(castAt(fold('seed', log), spellId, -40), spellId);
    const second = unwrap(castAt(fold('seed', log), spellId, -40), spellId);
    expect(first).toEqual(second);
  });

  it.each(CASTABLE.map((d) => [d.id] as const))('replays %s prefix by prefix', (spellId) => {
    const base = logFor(spellId);
    const out = unwrap(castAt(fold('seed', base), spellId, -40), spellId);
    const log = [...base, ...out.events];
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });
});

describe('a definition that leaves part of its spell out says so', () => {
  const withGaps = CASTABLE.filter((d) => (d.unmodelled ?? []).length > 0);

  it('has spells that admit to gaps, and spells that do not', () => {
    expect(withGaps.length).toBeGreaterThan(0);
    expect(withGaps.length).toBeLessThan(SPELL_DEFINITIONS.length);
  });

  it.each(withGaps.map((d) => [d.id, d] as const))(
    'reports what %s does not do, on the casting itself',
    (spellId, definition) => {
      const out = unwrap(castAt(fold('seed', logFor(spellId)), spellId, -40), spellId);
      for (const gap of definition.unmodelled ?? []) {
        expect(out.unverified).toContain(`${definition.name}: ${gap}`);
      }
    },
  );

  /** Fireball does everything Fireball does, so it claims nothing. */
  it('says nothing about a spell it fully executes', () => {
    const out = unwrap(castAt(base(), 'fireball', -40), 'fireball');
    expect(out.unverified).toEqual([]);
  });
});

describe('the shapes behave as their spells describe', () => {
  /** SRD Hold Monster is Hold Person without the Humanoid restriction. */
  it('holds a creature of any type, where Hold Person would not', () => {
    const dragon = fold('seed', setupWith('Dragon'));

    const person = resolveSpell(
      dragon,
      CASTER,
      { spellId: 'hold-person', targets: [TARGET], slotLevel: 2 },
      supply('hold', -40),
    );
    expect(isErr(person)).toBe(true);
    if (isErr(person)) expect(person.code).toBe('wrong_creature_type');

    const monster = unwrap(
      resolveSpell(
        dragon,
        CASTER,
        { spellId: 'hold-monster', targets: [TARGET], slotLevel: 5 },
        supply('hold', -40),
      ),
      'hold-monster',
    );
    expect(monster.outcomes[0]?.conditions).toEqual(['paralyzed']);
  });

  /**
   * SRD Blindness/Deafness lasts 1 minute with **no** Concentration, which is
   * a duration running on the clock rather than on the caster's attention.
   */
  it('runs a timed condition without the caster concentrating', () => {
    const out = unwrap(castAt(base(), 'blindness-deafness', -40), 'blind');

    const after = fold('seed', [...SETUP, ...out.events]);
    expect(after.creatures.target!.conditions.conditions).toContain('blinded');
    expect(after.creatures.caster!.concentration).toBeNull();
  });

  /** SRD Circle of Death grows by **2**d8 a level, not by one. */
  it('scales Circle of Death two dice at a time', () => {
    const low = unwrap(
      resolveSpell(
        base(),
        CASTER,
        { spellId: 'circle-of-death', targets: [], at: { x: 100, y: 105, z: 0 }, slotLevel: 6 },
        supply('cod', -40),
      ),
      'low',
    );
    const high = unwrap(
      resolveSpell(
        base(),
        CASTER,
        { spellId: 'circle-of-death', targets: [], at: { x: 100, y: 105, z: 0 }, slotLevel: 7 },
        supply('cod', -40),
      ),
      'high',
    );
    expect(high.outcomes[0]?.damage ?? 0).toBeGreaterThan(low.outcomes[0]?.damage ?? 0);
  });

  /**
   * SRD Eldritch Blast's upgrade adds *beams*, not dice, so its damage must
   * not grow with caster level the way every other attack cantrip's does.
   */
  it('keeps Eldritch Blast at one die however high the caster', () => {
    const blast = definitionFor('eldritch-blast');
    const bolt = definitionFor('fire-bolt');
    const blastEffect = blast?.effects[0];
    const boltEffect = bolt?.effects[0];
    if (blastEffect?.kind !== 'attack' || boltEffect?.kind !== 'attack') {
      throw new Error('expected attack effects');
    }
    expect(blastEffect.damage.cantripUpgradesAt).toBeUndefined();
    expect(boltEffect.damage.cantripUpgradesAt).toEqual([5, 11, 17]);
  });
});
