import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { declaredCasting } from '@ie/engine';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from '@ie/engine';
import { createRng, type Rng } from '@ie/engine';
import { createRollIssuer } from '@ie/engine';
import { fold, type GameEvent, type GameState } from '@ie/engine';
import { spellSlotKey } from '@ie/engine';
import {
  advanceTime,
  pendingCastingsOf,
  resolveDeclaredCast,
  resolveSpell,
} from '@ie/engine';
import {
  delaysDamage,
  riderDurations,
  statedFormOf,
  statesFoughtFact,
  teleportOf,
  weaponRiderOf,
} from '@ie/engine';

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
  // A Club and a Quarterstaff apiece, for the spells that imbue **one weapon**
  // and are refused until the caster names one the target has got. Those two
  // rather than any others because Shillelagh names two objects by id and
  // these are they, where Magic Weapon narrows nothing and takes either.
  // Carried and not equipped: nothing here reads a hand, and an equipped
  // weapon would change what a spell needing a free one could do.
  ...([CASTER, TARGET, BYSTANDER] as const).map(
    (who): GameEvent => ({
      type: 'items-gained',
      id: who,
      items: [
        { id: 'club', quantity: 1 },
        { id: 'quarterstaff', quantity: 1 },
      ],
      source: 'the fixture',
    }),
  ),
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
  content: SRD_CONTENT,
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
  const definition = SRD_CONTENT.spell(spellId);
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
  //
  // **And a printed later consequence is the third way a casting needs one.**
  // SRD Acid Arrow's "2d4 Acid damage at the end of its next turn" is anchored
  // on the target rather than on the caster and carries no `lasts` to read, so
  // `riderDurations` cannot see it: the question is `delaysDamage`, which is
  // the same rule — which effects need a turn order is the command layer's
  // answer and not this file's.
  const anchored =
    definition?.durationUntil !== undefined ||
    (definition !== null &&
      (delaysDamage(definition) ||
        riderDurations(definition).some((lasts) => typeof lasts === 'string')));

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
          : definition?.trigger === 'creature-falling'
            ? // A fall declared for the creature the fixture goes on to cast
              // at, because this window's target rule reads the same fact the
              // trigger does — "up to five **falling** creatures" — so a fall
              // declared for anybody else would open the window and refuse
              // every target in it.
              ([{ type: 'fall-declared', id: TARGET }] as readonly GameEvent[])
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
  const definition = SRD_CONTENT.spell(spellId);
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
    // The fifth, and the same shape a fourth time: a spell that prints a
    // choice is refused until the caster makes it, and one that prints none is
    // refused for making one. The sweep answers with the **first** printed
    // value, because the point here is that every definition casts rather than
    // which condition, ability or skill this casting picked — the reason the
    // stated damage type above takes the same answer.
    ...(definition.choiceStated === undefined
      ? {}
      : { choice: definition.choiceStated.options[0]! }),
    // The sixth, and the same shape a fifth time: a spell that imbues a weapon
    // is refused until the caster names one, and a spell that imbues none is
    // refused for naming one. The sweep answers with the **first** weapon the
    // spell names, or the Quarterstaff everybody is carrying where it narrows
    // nothing — the point here is that every definition casts rather than
    // which stick it was pointed at. `weaponRiderOf` is the runtime's own
    // reader, for the reason `teleportOf` is used above.
    ...(weaponRiderOf(definition) === null
      ? {}
      : { weapon: weaponRiderOf(definition)!.weapons?.[0] ?? 'quarterstaff' }),
    // The seventh, and the same shape a sixth time: a summoning spell that
    // leaves the form to its caster is refused until the caster names one,
    // and one that names its own block is refused for naming a form. The
    // sweep answers with the **first** printed form — SRD Find Familiar's Bat
    // — because the point here is that every definition casts rather than
    // which animal this casting called. `statedFormOf` is the runtime's own
    // reader, for the reason the three above are.
    ...(statedFormOf(definition) === null ? {} : { form: statedFormOf(definition)!.among[0]! }),
  };
  // The caster's own square. Deliberate: a Cube or Cone excludes its point of
  // origin, so an area placed *on* the target would leave them out of it —
  // correct by the rules, and a fixture that looked like a broken spell.
  const at = { x: 100, y: 100, z: 0 };

  /** A shape that has to be pointed somewhere: a Cone, a Cube or a Line. */
  const directionalShape = (shape: { readonly kind: string } | undefined): boolean =>
    shape !== undefined && ['cone', 'cube', 'line'].includes(shape.kind);

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
    //
    // **And a bound that is a Cube has to be pointed**, exactly as an `area`
    // Cube does. SRD Slow is the first of them — "up to six creatures of your
    // choice in a 40-foot Cube" — and while every bounded list in the
    // catalogue was a Sphere the two branches could differ without anything
    // noticing.
    const placed =
      definition.targetsWithin !== undefined || definition.origin !== undefined
        ? { at, ...(directionalShape(definition.targetsWithin) ? { towards } : {}) }
        : {};
    return resolveSpell(
      state,
      CASTER,
      { spellId, targets, ...placed, ...stated, ...(slotLevel === undefined ? {} : { slotLevel }) },
      supply(seed, bonus),
    );
  }

  const directional = directionalShape(definition.area);
  // The ninth stated fact, and the only one that is a **shape**: SRD Wind
  // Wall's "you can shape the wall in any way you choose so long as it makes
  // one continuous path along the ground" is drawn by whoever casts it, and a
  // casting that draws nothing is refused. The sweep draws fifteen feet
  // northward out of the caster's own square — well inside the shortest wall
  // the catalogue holds, continuous, on one ground, and running through the
  // square TARGET is standing in, because the point here is that every
  // definition casts *and catches somebody*.
  const drawn =
    definition.area.kind === 'wall'
      ? {
          path: [at, { x: at.x, y: at.y + 5, z: at.z }, { x: at.x, y: at.y + 10, z: at.z }],
        }
      : {};
  return resolveSpell(
    state,
    CASTER,
    {
      spellId,
      // The eighth stated fact, and the only one that is a list of creatures:
      // SRD Sleep's "each creature **of your choice** in a 5-foot-radius
      // Sphere" leaves the subset to the caster, and a casting that names
      // nobody is refused rather than catching everybody. The sweep names the
      // one creature it has, who is standing five feet away and so inside
      // every template here.
      targets: definition.targets.chosenFromTheArea === true ? [TARGET] : [],
      ...(definition.area.origin === 'point' ? { at } : {}),
      ...(directional ? { towards } : {}),
      ...drawn,
      ...stated,
      ...(slotLevel === undefined ? {} : { slotLevel }),
    },
    supply(seed, bonus),
  );
};

/**
 * The whole casting as a flat batch, declaration and settlement alike.
 *
 * `castAt` returns whatever `resolveSpell` gave, which for a casting of a
 * minute or more is a **declaration**: the action is spent, the casting is
 * open, and the slot and the effects wait on the clock. This drives the clock
 * to the moment the definition's own `castingSeconds` names and settles the
 * casting by its id, so a sweep over the whole catalogue asks every definition
 * the same question rather than asking twelve of them half of it.
 */
const castAndSettle = (spellId: string, bonus = -40, seed = 'cast'): readonly GameEvent[] => {
  const base = logFor(spellId);
  const first = unwrap(castAt(fold('seed', base), spellId, bonus, seed), spellId);
  const definition = SRD_CONTENT.spell(spellId)!;
  if (definition.castingTime !== 'long') return first.events;

  const open = fold('seed', [...base, ...first.events]);
  const castingId = pendingCastingsOf(open)[0]!.castingId;
  const tick = unwrap(advanceTime(open, definition.castingSeconds!, 'the rite'), `tick ${spellId}`);
  const ticked = [...base, ...first.events, ...tick];
  const settled = unwrap(
    resolveDeclaredCast(fold('seed', ticked), castingId, supply(seed, bonus)),
    `settle ${spellId}`,
  );
  return [...first.events, ...tick, ...settled.events];
};

/**
 * The same drive, returning the **outcome** rather than the events.
 *
 * `castAt` hands back a declaration for a casting of a minute or more, and a
 * declaration resolves nothing: the outcomes arrive when the rite settles. That
 * was invisible while every long casting in the catalogue was tracked — a
 * tracked spell has no outcomes either way — and the first executed one, SRD
 * Regenerate, would have failed the sweep below for being long rather than for
 * being wrong. So the sweep asks the settled casting, exactly as the
 * one-casting sweep above already does.
 */
const castFully = (spellId: string, bonus = -40, seed = 'cast') => {
  const base = logFor(spellId);
  const first = unwrap(castAt(fold('seed', base), spellId, bonus, seed), spellId);
  const definition = SRD_CONTENT.spell(spellId)!;
  if (definition.castingTime !== 'long') return first;

  const open = fold('seed', [...base, ...first.events]);
  const castingId = pendingCastingsOf(open)[0]!.castingId;
  const tick = unwrap(advanceTime(open, definition.castingSeconds!, 'the rite'), `tick ${spellId}`);
  const settled = unwrap(
    resolveDeclaredCast(fold('seed', [...base, ...first.events, ...tick]), castingId, supply(seed, bonus)),
    `settle ${spellId}`,
  );
  return {
    ...settled,
    events: [...first.events, ...tick, ...settled.events],
    outcomes: [...first.outcomes, ...settled.outcomes],
    unverified: [...first.unverified, ...settled.unverified],
  };
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

/**
 * And a spell cast **as** a weapon attack, refused by the same command a line
 * later and for the same reason one line earlier.
 *
 * SRD True Strike: "you make one attack with the weapon used in the spell's
 * casting." The casting and the swing are one moment, so the swing names the
 * cantrip — `resolveAttack` — and this command, which makes no attack, cannot
 * be handed one. Driven by `cantrip-with-the-swing.test.ts`.
 */
const WITH_A_SWING = SPELL_DEFINITIONS.filter((d) =>
  d.effects.some((effect) => effect.kind === 'weapon-attack'),
);
const CASTABLE = SPELL_DEFINITIONS.filter(
  (d) => !ON_HIT.includes(d) && !WITH_A_SWING.includes(d),
);

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

describe('a spell cast as a hit is refused by the same command', () => {
  it('has some, so the rule below is not vacuous', () => {
    expect(WITH_A_SWING.length).toBeGreaterThan(0);
  });

  it.each(WITH_A_SWING.map((d) => [d.id] as const))('refuses %s, and says why', (spellId) => {
    const out = castAt(fold('seed', logFor(spellId)), spellId, -40);
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('cast_with_a_swing');
  });
});

describe('every definition in the catalogue actually casts', () => {
  it.each(CASTABLE.map((d) => [d.id] as const))('resolves %s', (spellId) => {
    // A failed save for anything that allows one, so the interesting branch is
    // the one that runs.
    const out = castFully(spellId);
    expect(out.castingId!.length).toBeGreaterThan(0);

    expect(out.events.length).toBeGreaterThan(0);

    // Something happened to somebody: a spell that resolves to nothing at all
    // is a definition that compiles and does not work. A **tracked** spell is
    // the deliberate exception — it resolves to a casting and nothing else —
    // and it owes the stronger obligation instead: it must say what the DM is
    // being left to do, or it is a definition that quietly does nothing.
    const definition = SRD_CONTENT.spell(spellId)!;
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

  /**
   * **One casting, however many events it takes to record one.**
   *
   * A casting of a minute or more is a *declared* one — `spell-declared`, a
   * span on the clock, and `spell-cast` only when the rite finishes — so a
   * sweep that read the first batch alone would assert zero for the twelve
   * definitions that print one, and a sweep that asserted "one of either"
   * would stop noticing a settlement that wrote a second. Driving both halves
   * is what keeps the claim the claim: **exactly one `spell-cast` per casting,
   * for every definition in the catalogue.**
   */
  it.each(CASTABLE.map((d) => [d.id] as const))('spends exactly one casting for %s', (spellId) => {
    const out = castAndSettle(spellId);
    expect(out.filter((e) => e.type === 'spell-cast')).toHaveLength(1);
    // And a long casting really does take the two-event route, so the branch
    // above is exercised rather than merely present.
    expect(out.some((e) => e.type === 'spell-declared')).toBe(
      SRD_CONTENT.spell(spellId)!.castingTime === 'long',
    );
  });

  /** Same state, same seed, same batch — twice. */
  it.each(CASTABLE.map((d) => [d.id] as const))('is deterministic for %s', (spellId) => {
    const log = logFor(spellId);
    const first = unwrap(castAt(fold('seed', log), spellId, -40), spellId);
    const second = unwrap(castAt(fold('seed', log), spellId, -40), spellId);
    expect(first).toEqual(second);
  });

  it.each(CASTABLE.map((d) => [d.id] as const))('replays %s prefix by prefix', (spellId) => {
    const log = [...logFor(spellId), ...castAndSettle(spellId)];
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

/**
 * The definitions this batch executed, driven one at a time as well as swept.
 *
 * The sweeps above are parameterised over whatever the catalogue holds, which
 * makes them worthless as the *first* test of a definition — a spell that does
 * not exist is a spell no sweep has an entry for. So each of these is named,
 * and each is asserted against the one thing its own SRD paragraph prints that
 * the sweep cannot know: the die it rolls, the type it deals, and the rider it
 * leaves behind.
 */
describe('every definition this batch executed resolves its own dice', () => {
  /**
   * A casting that names a damage type the spell does not print, and one that
   * names none at all.
   *
   * **This is how a `damageTypeStated` list is checked rather than read
   * back.** Asserting the field equals what the definition says would be the
   * definition agreeing with itself; asserting that the engine *refuses* a
   * sixth type and refuses silence proves the list reached the code that
   * decides, which is the only claim a definition can make about it. Where
   * the stated type then lands in the damage is `held-casting-facts.test.ts`'s
   * and is not restated here.
   */
  /**
   * The damage one casting deals, over two dozen generators, and its mean.
   *
   * **One seeded casting cannot pin a number of dice**, and the mutation that
   * proved it was cutting Conjure Fey's 3d12 to 1d12: a single roll still
   * cleared the floor of three dice plus a +5 modifier, so the suite went
   * green on a spell dealing a third of its damage. A floor is what the
   * SRD-policy note says catches a dropped *addend*; a dropped **die** needs
   * something else, because the two distributions overlap at both ends once a
   * natural 20 doubles them. What does not overlap is the middle, so each
   * spell below is held to two numbers: a minimum no roll of the right
   * notation can go under, and an average only the right count of dice
   * reaches.
   *
   * Deterministic, because every seed is written down. **Misses are dropped
   * rather than counted as nothing**: a natural 1 misses however large the
   * bonus, which is an attack-roll rule the SRD-policy note names, and a zero
   * folded into the average would say a spell rolls fewer dice than it does.
   * The count that survives is asserted, so the filter cannot hide a spell
   * that stopped hitting altogether.
   */
  const SEEDS: readonly string[] = Array.from({ length: 24 }, (_, i) => `roll-${i}`);

  const damageOver = (
    spellId: string,
    over: Record<string, unknown> = {},
    log: readonly GameEvent[] = SETUP,
  ): readonly number[] =>
    SEEDS.map((seed) => {
      const definition = SRD_CONTENT.spell(spellId)!;
      const out = unwrap(
        resolveSpell(
          fold('seed', log),
          CASTER,
          {
            spellId,
            targets: [TARGET],
            ...(definition.level === 0 ? {} : { slotLevel: definition.level }),
            ...(definition.damageTypeStated === undefined
              ? {}
              : { damageType: definition.damageTypeStated[0]! }),
            // A casting that holds a point takes one: the caster's own
            // square, which `castAt` uses for the same reason.
            ...(definition.origin === undefined ? {} : { at: { x: 100, y: 100, z: 0 } }),
            ...over,
          },
          // A bonus large enough that the attack cannot miss, because what is
          // being measured is the payload rather than the roll.
          supply(seed, 40),
        ),
        `${spellId} @ ${seed}`,
      );
      return out.outcomes[0]?.attack?.hit === false ? null : (out.outcomes[0]?.damage ?? 0);
    }).filter((damage): damage is number => damage !== null);

  const mean = (rolled: readonly number[]): number =>
    rolled.reduce((total, one) => total + one, 0) / rolled.length;

  const statingType = (spellId: string, damageType: string | undefined) =>
    resolveSpell(
      base(),
      CASTER,
      {
        spellId,
        targets: [TARGET],
        ...(SRD_CONTENT.spell(spellId)!.level === 0
          ? {}
          : { slotLevel: SRD_CONTENT.spell(spellId)!.level }),
        ...(damageType === undefined ? {} : { damageType }),
      },
      supply('typed', 40),
    );

  /**
   * SRD Conjure Fey: "On a hit, the target takes Psychic damage equal to 3d12
   * plus your spellcasting ability modifier, and the target has the Frightened
   * condition until the start of your next turn."
   *
   * Three dice and the caster's +5, so no casting comes to less than 8 and
   * the mean sits above twenty-four. One die instead of three averages eleven
   * and a half, which is the mutation this pair was written against.
   */
  it('strikes with the Feywild spirit, and frightens what it hits', () => {
    // Driven in a fight, because "until the start of your next turn" has no
    // meaning outside one and the engine refuses rather than inventing six
    // seconds. `logFor` supplies the turn order for exactly that reason.
    const fight = logFor('conjure-fey');
    const out = unwrap(castAt(fold('seed', fight), 'conjure-fey', 40, 'fey'), 'conjure-fey');
    expect(out.outcomes[0]?.attack?.hit).toBe(true);
    expect(out.outcomes[0]?.conditions).toEqual(['frightened']);

    const rolled = damageOver('conjure-fey', {}, fight);
    expect(rolled.length).toBeGreaterThan(18);
    expect(Math.min(...rolled)).toBeGreaterThanOrEqual(8);
    expect(mean(rolled)).toBeGreaterThan(18);
  });

  /**
   * And the Bonus Action on a later turn is the same blow from a point that
   * has moved, which is the half `origin.movableBy` exists for. Asserted as
   * the registered activation rather than driven, because moving the spirit
   * thirty feet is `spiritual-weapon`'s machinery and has its own tests.
   */
  it('registers the spirit’s later strike as a Bonus Action within thirty feet', () => {
    const definition = SRD_CONTENT.spell('conjure-fey')!;
    expect(definition.activation?.action).toBe('bonus-action');
    expect(definition.origin).toEqual({ reach: 5, movableBy: 30 });
    expect(definition.activation?.effects[0]?.kind).toBe('attack');
  });

  /**
   * SRD Sorcerous Burst: "On a hit, the target takes 1d8 damage of a type you
   * choose", and the cantrip upgrade at 5, 11 and 17 — so a level 20 caster
   * throws 4d8 and cannot roll less than four.
   */
  it('throws four dice of Sorcerous Burst at a level 20 caster, in the type stated', () => {
    const out = unwrap(castAt(base(), 'sorcerous-burst', 40, 'burst'), 'sorcerous-burst');
    expect(out.outcomes[0]?.attack?.hit).toBe(true);

    // Four dice of eight: never under four, averaging eighteen where a
    // cantrip that had lost its upgrade would average four and a half.
    const rolled = damageOver('sorcerous-burst');
    expect(rolled.length).toBeGreaterThan(18);
    expect(Math.min(...rolled)).toBeGreaterThanOrEqual(4);
    expect(mean(rolled)).toBeGreaterThan(12);

    // And the seven printed types are the whole of the list: Psychic is one
    // of them, Radiant is not, and a casting that names neither is refused
    // rather than guessed at.
    expect(isErr(statingType('sorcerous-burst', 'psychic'))).toBe(false);
    const wrong = statingType('sorcerous-burst', 'radiant');
    expect(isErr(wrong)).toBe(true);
    if (isErr(wrong)) expect(wrong.code).toBe('unknown_damage_type');
    const silent = statingType('sorcerous-burst', undefined);
    expect(isErr(silent)).toBe(true);
  });

  /**
   * SRD Chromatic Orb: "On a hit, the target takes 3d8 damage of the chosen
   * type", growing by 1d8 a slot level. The minimum at level 1 is 3 and at
   * level 3 is 5, which is the assertion that catches a scaling that was
   * written and never read.
   */
  it('grows Chromatic Orb by a die a slot level', () => {
    // Three dice of eight at its own level: never under three, averaging
    // thirteen and a half.
    const low = damageOver('chromatic-orb');
    expect(low.length).toBeGreaterThan(18);
    expect(Math.min(...low)).toBeGreaterThanOrEqual(3);
    expect(mean(low)).toBeGreaterThan(9);

    // Eleven at a level 9 slot: never under eleven, and averaging about fifty
    // where a definition that had lost its per-slot scaling still averages
    // thirteen.
    const high = damageOver('chromatic-orb', { slotLevel: 9 });
    expect(Math.min(...high)).toBeGreaterThanOrEqual(11);
    expect(mean(high)).toBeGreaterThan(35);

    // Six printed types rather than Sorcerous Burst's seven — this one omits
    // Psychic — so the same refusal falls on a different word.
    const wrong = statingType('chromatic-orb', 'psychic');
    expect(isErr(wrong)).toBe(true);
  });

  /**
   * SRD Fire Shield: "The warm shield grants you Resistance to Cold damage,
   * and the chill shield grants you Resistance to Fire damage."
   *
   * **The one definition in this batch that rolls no dice of its own**, which
   * is exactly why it needed driving rather than reading: an independent
   * review turned `defense: 'resistant'` into `'immune'` and turned the
   * stated-type list from Cold and Fire into Cold and Acid, and the whole
   * suite stayed green for both. What a granted defence does is only visible
   * in somebody else's damage, so that is what this measures — Ray of Frost,
   * thrown at the shielded caster by a second creature, with and without the
   * shield and under each of the two things the caster may state.
   *
   * Three castings, and the three answers are different numbers: no shield is
   * full damage, the shield the caster asked Cold of is half, and the shield
   * they asked Fire of is full again because Ray of Frost is Cold. An
   * Immunity would read zero at the second, and a list naming Acid would be
   * refused at the third.
   */
  it('halves the Cold that reaches a warm Fire Shield, and only the Cold', () => {
    // The shield goes up out of combat, because it wants no turn order and
    // the Cold that tests it does: Ray of Frost's halved Speed lasts "until
    // the start of your next turn", which has no meaning outside a fight.
    const shielded = (stated: string | null): readonly GameEvent[] => {
      const raised =
        stated === null
          ? []
          : unwrap(
              resolveSpell(
                base(),
                CASTER,
                {
                  spellId: 'fire-shield',
                  targets: [CASTER],
                  slotLevel: 4,
                  damageType: stated,
                },
                supply('shield', 40),
              ),
              `fire-shield stating ${stated}`,
            ).events;
      return [
        ...SETUP,
        ...raised,
        // A second creature who knows one cantrip, because Fire Shield is
        // Range Self and the caster cannot throw Cold at themselves. It acts
        // first, so the Cold arrives on its own turn.
        {
          type: 'spellcasting-declared',
          id: TARGET,
          spellcasting: declaredCasting({ ability: 'int', cantrips: ['ray-of-frost'] }),
        },
        {
          type: 'combat-started',
          combatants: [
            { id: TARGET, initiative: 20, speed: 30 },
            { id: CASTER, initiative: 10, speed: 30 },
            { id: BYSTANDER, initiative: 5, speed: 30 },
          ],
        },
      ];
    };

    const over = (log: readonly GameEvent[]): readonly number[] =>
      SEEDS.map((seed) => {
        const out = unwrap(
          resolveSpell(
            fold('seed', log),
            TARGET,
            { spellId: 'ray-of-frost', targets: [CASTER] },
            supply(seed, 40),
          ),
          'ray-of-frost',
        );
        return out.outcomes[0]?.attack?.hit === false ? -1 : (out.outcomes[0]?.damage ?? 0);
      }).filter((damage) => damage >= 0);

    const bare = over(shielded(null));
    const warm = over(shielded('cold'));
    const chill = over(shielded('fire'));
    expect(bare.length).toBeGreaterThan(18);
    expect(warm.length).toBe(bare.length);
    expect(chill.length).toBe(bare.length);

    // Halved, which an Immunity would read as nothing and no defence at all
    // would read as the full number.
    expect(mean(warm)).toBeLessThan(mean(bare) * 0.6);
    expect(mean(warm)).toBeGreaterThan(mean(bare) * 0.4);
    // And the other shield resists Fire, so the Cold comes through whole.
    expect(chill).toEqual(bare);

    // The two the book prints are the whole of the list, and a casting that
    // states neither is refused rather than guessed at.
    expect(SRD_CONTENT.spell('fire-shield')?.damageTypeStated).toEqual(['cold', 'fire']);
    expect(isErr(statingType('fire-shield', 'acid'))).toBe(true);
    expect(isErr(statingType('fire-shield', undefined))).toBe(true);
  });

  /**
   * SRD Searing Smite: "As you hit the target, it takes an extra 1d6 Fire
   * damage from the attack."
   *
   * Cast on a hit, so `resolveSpell` refuses it and the sweep above asserts
   * that refusal. What is asserted here is that the refusal is the *right*
   * one — the definition carries an `attack-damage` effect, which is the kind
   * `resolveAttackDamage` settles — rather than the spell being missing.
   */
  it('hangs Searing Smite’s extra die on the attack that triggered it', () => {
    const definition = SRD_CONTENT.spell('searing-smite')!;
    const effect = definition.effects[0];
    expect(effect?.kind).toBe('attack-damage');
    if (effect?.kind !== 'attack-damage') throw new Error('expected attack-damage');
    expect(effect.damage).toEqual({ dice: '1d6', perSlotLevelAbove: '1d6' });
    expect(effect.damageType).toBe('fire');
    expect(ON_HIT.map((d) => d.id)).toContain('searing-smite');
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
    const blast = SRD_CONTENT.spell('eldritch-blast');
    const bolt = SRD_CONTENT.spell('fire-bolt');
    const blastEffect = blast?.effects[0];
    const boltEffect = bolt?.effects[0];
    if (blastEffect?.kind !== 'attack' || boltEffect?.kind !== 'attack') {
      throw new Error('expected attack effects');
    }
    expect(blastEffect.damage.cantripUpgradesAt).toBeUndefined();
    expect(boltEffect.damage.cantripUpgradesAt).toEqual([5, 11, 17]);
  });
});
