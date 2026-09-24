import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from '@ie/engine';
import type { CreatureSize } from '@ie/srd/schemas';
import { createRng, type Rng } from '@ie/engine';
import { createRollIssuer } from '@ie/engine';
import { fold, type GameEvent, type GameState } from '@ie/engine';
import { remaining, spellSlotKey } from '@ie/engine';
import { declaredCasting } from '@ie/engine';
import { dropsAnObject } from '@ie/engine';
import { dmDecisionsIn } from '@ie/engine';
import { riderDurations, type RiderDuration } from '@ie/engine';
import {
  advanceTime,
  DIRECTIONAL_AREAS,
  pendingCastingsOf,
  type Point,
  resolveDamage,
  resolveDeclaredCast,
  resolveSpell,
} from '@ie/engine';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isExecuted } from '../scripts/coverage-data.js';
import { FEATURE_SHAPES } from '../scripts/missing-feature-shapes.js';
import {
  ITEM_SHAPES,
  MISSING_SHAPES,
  TRACKED_ADJUDICATED as ADJUDICATED,
  mechanicalMarkersIn,
  misanchoredAdjudications,
  sentencesOf,
  unanchoredPhrases,
  unansweredMarkers,
  type MarkerId,
  type TrackedAdjudication,
} from '../scripts/missing-shapes.js';

/**
 * Spells the engine **tracks** without **executing**.
 *
 * Ninety-one SRD spells do something the engine has no business deciding:
 * Disguise Self changes how you look, Speak with Animals lets you talk to a
 * badger, Detect Magic tells you there is magic nearby. Those are the DM's,
 * and they always will be.
 *
 * But "the effect is the DM's" is not the same as "the engine knows nothing",
 * and that is what refusing the cast outright amounted to. A Wizard who cast
 * Fly spent a level 3 slot, gave up whatever they were concentrating on, used
 * their action, and started a ten-minute clock — every one of which is
 * arithmetic the engine owns, and none of which happened, because the spell
 * had no executable definition and `resolveSpell` refused it.
 *
 * So there are two kinds of definition, and the difference is `effects`:
 *
 * | | |
 * |---|---|
 * | **executed** | the engine resolves what the spell does |
 * | **tracked** | the engine spends the cost and runs the clock; `unmodelled` says what the DM does |
 *
 * A tracked definition is not a stub. It carries the real casting time, the
 * real Concentration, the real duration, the real range and the real target
 * rule, all checked against the book — and it must say what it is leaving to
 * the table, because a definition that quietly did nothing would be worse than
 * the refusal it replaced.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const ALLY = id('ally');
const FOE = id('foe');
const BEAST = id('beast');
const RAVEN = id('raven');
const CORPSE = id('corpse');

/** The one thing this table puts in a hand — see the setup below. */
const HEATED = 'quarterstaff';

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

const added = (
  who: CharacterId,
  creatureType = 'Humanoid',
  size?: CreatureSize,
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 50,
  diesAtZero: false,
  creatureType,
  ...(size === undefined ? {} : { size }),
});

/**
 * Every tracked spell there is, read off the catalogue rather than listed.
 *
 * A hand-written list would drift the moment somebody adds a definition with
 * no effects, and the spell that drifted off it is exactly the one nobody
 * drove. `effects.length === 0` is the same predicate `coverage.ts` counts
 * with, so the list under test and the number in `COVERAGE.md` cannot disagree.
 */
const TRACKED: readonly string[] = SPELL_DEFINITIONS.filter(
  // **Asked of the one predicate**, rather than written out a fourth time. A
  // spell whose *activation* the engine resolves is executed, not tracked —
  // Flame Blade's casting evokes a blade and does nothing else, and every blow
  // it strikes comes through machinery the engine owns — and so is one whose
  // whole effect is what it conjures. A copy of that reading here is a copy
  // that stops covering a spell the day an arm is added to it, which is
  // exactly what `isExecuted`'s own docstring records happening before.
  (d) => !isExecuted(d),
)
  .map((d) => d.id)
  .sort();

/**
 * A creature of every type a tracked definition may demand, so a spell that
 * checks one is aimed at something it accepts rather than excused the check.
 *
 * `spell-catalogue.test.ts` already draws this line for the executed bucket —
 * "the fixture says what the target is rather than the spell being excused" —
 * and it arrived here the day a tracked definition first wrote `mustBeType`.
 * A type is durable, so the table holds one creature per type rather than
 * rewriting one; the lookup throws for a type nobody added, because a fixture
 * silently aiming at the wrong creature is how a refusal becomes the
 * fixture's rather than the spell's.
 */
const TYPED: Readonly<Record<string, CharacterId>> = { Humanoid: ALLY, Beast: BEAST };

/**
 * And one creature per **type and size** a tracked definition may demand.
 *
 * SRD Animal Messenger takes "a Tiny Beast", which the Wolf standing in for
 * every Beast is not — and the refusal of a Wolf is the spell working rather
 * than the fixture being in the way. Keyed by both facts, and the lookup
 * throws for a pair nobody added, exactly as {@link TYPED} does.
 */
const SIZED: Readonly<Record<string, CharacterId>> = { 'Beast/tiny': RAVEN };

/**
 * Where an area spell puts its template: a point 50 feet from the door, and a
 * direction for the shapes that need one.
 *
 * Inside the scene, inside every printed Range this table casts, and far
 * enough from the creatures that nothing here turns on who is caught — these
 * sweeps are about a spell being *cast* rather than refused.
 */
const AREA_AT: Point = { x: 100, y: 100, z: 0 };
const AREA_TOWARDS: Point = { x: 150, y: 100, z: 0 };

const SETUP: readonly GameEvent[] = [
  added(WIZARD),
  added(ALLY),
  added(FOE),
  added(BEAST, 'Beast'),
  added(RAVEN, 'Beast', 'tiny'),
  added(CORPSE),
  // **And one creature who has just died**, for the spell that raises one.
  // SRD Revivify reaches "a creature that has died within the last minute",
  // and a corpse is what it is aimed at — the refusal of a living target is
  // the spell working rather than the fixture being in the way, which is the
  // rule the types and the size above are held to. Nothing here moves the
  // clock, so the death is always this instant.
  { type: 'creature-died', id: CORPSE, cause: 'the fixture' },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(
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
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the door', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the door' }, feet: 0 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { creature: WIZARD }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: FOE, placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 } },
  { type: 'creature-placed', id: BEAST, placement: { from: { creature: WIZARD }, feet: 5, bearing: 180 } },
  { type: 'creature-placed', id: RAVEN, placement: { from: { creature: WIZARD }, feet: 5, bearing: 270 } },
  { type: 'creature-placed', id: CORPSE, placement: { from: { creature: WIZARD }, feet: 5, bearing: 45 } },
  { type: 'sight-declared', from: WIZARD, to: ALLY, seen: true },
  { type: 'sight-declared', from: WIZARD, to: FOE, seen: true },
  { type: 'sight-declared', from: WIZARD, to: BEAST, seen: true },
  { type: 'sight-declared', from: WIZARD, to: RAVEN, seen: true },
  { type: 'sight-declared', from: WIZARD, to: CORPSE, seen: true },
  // **And a thing in the ally's hand**, for the spell that heats one: SRD Heat
  // Metal refuses an object its target is neither wearing nor wielding, and
  // the fixture supplies the wielding rather than the spell being excused the
  // rule. A Quarterstaff, because it is wielded and so can be let go of.
  { type: 'items-gained', id: ALLY, items: [{ id: HEATED, quantity: 1 }], source: 'the fixture' },
  { type: 'item-equipped', id: ALLY, item: HEATED, armor: null },
  // The ally is falling, which is the same discipline the types above follow:
  // the fixture supplies the moment a Reaction spell answers rather than the
  // spell being excused its own casting time. A fall is momentary and this
  // table never moves a turn or the clock, so the window stays open for every
  // cast driven off `SETUP` — and closes in the `inCombat` logs below, which
  // start a fight after it and so are a different instant. `falling.test.ts`
  // is where the opening and closing are the subject.
  { type: 'fall-declared', id: ALLY },
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      cantrips: SPELL_DEFINITIONS.filter((d) => d.level === 0).map((d) => d.id),
      prepared: SPELL_DEFINITIONS.filter((d) => d.level > 0).map((d) => d.id),
    }),
  },
];

const supply = () => ({ issuer: createRollIssuer('r'), rng: createRng('cast') as Rng, content: SRD_CONTENT });

/** Cast a tracked spell at whatever its target rule asks for. */
const cast = (
  spellId: string,
  over: Partial<Parameters<typeof resolveSpell>[2]> = {},
  log: readonly GameEvent[] = SETUP,
) => {
  const definition = SRD_CONTENT.spell(spellId);
  if (definition === null) throw new Error(`${spellId} has no definition`);
  const wanted = definition.targets.mustBeType;
  const sized = definition.targets.mustBeSize;
  const raises = definition.effects.some((effect) => effect.kind === 'revive');
  const heats = dropsAnObject(definition);
  const at = raises
    ? CORPSE
    :
    sized !== undefined
      ? SIZED[`${wanted ?? 'Humanoid'}/${sized}`]
      : wanted === undefined
        ? ALLY
        : TYPED[wanted];
  if (at === undefined) {
    throw new Error(
      `${spellId} wants a ${sized === undefined ? '' : `${sized} `}${wanted ?? 'creature'} and this table has none`,
    );
  }
  // A spell that aims at nobody gets nobody, and `unlimited` is the third
  // state: the SRD states no count, so the list is not empty — it is
  // bounded by range and sight instead. The same predicate
  // `spell-catalogue.test.ts` casts the executed bucket with.
  const aimsAtNobody =
    definition.targets.count === 0 && definition.targets.unlimited !== true;
  // **A spell whose printed Range is Self is aimed at the caster**, and there
  // is nobody else it could be aimed at. It did not come up while every such
  // definition in this bucket took no target at all; Magic Jar takes one now,
  // because a definition that resolves something has to say whose body it is
  // about.
  const mine = definition.range.kind === 'self' && definition.targets.self === true;
  const targets = aimsAtNobody ? [] : [mine ? WIZARD : at];
  // The eighth stated fact: a spell aimed at an object is refused until the
  // caster names which, and one that touches none is refused for naming one.
  const object = heats ? { object: HEATED } : {};
  // **A spell that fills an area needs somewhere to put it**, and a Cone, a
  // Cube or a Line needs somewhere to point it as well. No tracked definition
  // carries one — a tracked spell resolves nothing, so there is nothing for a
  // template to catch — and one of the spells this list records did grow
  // effects and an area on the same commit, so the departed rows go through
  // the same helper as the rest. The caster's own square, as the executed
  // sweep uses: a Cube excludes its point of origin, so an area placed on the
  // target would leave them out of it.
  const area = definition.area;
  const placed =
    area === undefined
      ? {}
      : {
          ...(area.origin === 'point' ? { at: { x: 50, y: 50, z: 0 } } : {}),
          ...(['cone', 'cube', 'line'].includes(area.kind)
            ? { towards: { x: 50, y: 150, z: 0 } }
            : {}),
        };
  return resolveSpell(
    fold('seed', log),
    WIZARD,
    {
      spellId,
      targets,
      ...placed,
      ...object,
      ...(definition.level === 0 ? {} : { slotLevel: definition.level }),
      // A spell that prints a choice is refused until the caster makes it, and
      // the first printed value is the answer here for the reason the executed
      // sweep gives: what this file claims is that every one of these is cast
      // rather than refused, not which of the printed values it chose.
      ...(definition.choiceStated === undefined
        ? {}
        : { choice: definition.choiceStated.options[0]! }),
      // And the same for a printed list of damage types, which is the other
      // fact a casting is refused for leaving unstated — `damage_type_required`
      // rather than `choice_required`, and the same reading: what this file
      // claims is that every one of these is cast rather than refused, not
      // which of the eleven SRD Resistance's caster named.
      ...(definition.damageTypeStated === undefined
        ? {}
        : { damageType: definition.damageTypeStated[0]! }),
      // **An area needs a point, and a directional one a direction**: the two
      // facts `resolveTargets` demands of any spell with a volume. Derived
      // from the definition rather than listed by spell id, so the next
      // definition that grows an area needs no line here. The point is inside
      // the scene and within every Range this table's spells print.
      ...(definition.area === undefined
        ? {}
        : {
            at: AREA_AT,
            ...(DIRECTIONAL_AREAS.has(definition.area.kind) ? { towards: AREA_TOWARDS } : {}),
            // **And a wall needs its path**, which is the third fact an area
            // can demand and the only one that is a shape rather than a point:
            // SRD Wind Wall is drawn by whoever casts it, and a casting that
            // draws nothing is refused. Derived from the definition for the
            // reason the point above is — fifteen feet eastward out of
            // `AREA_AT`, which is continuous, on one ground and inside every
            // wall length the catalogue prints.
            ...(definition.area.kind === 'wall'
              ? {
                  path: [
                    AREA_AT,
                    { x: AREA_AT.x + 5, y: AREA_AT.y, z: AREA_AT.z },
                    { x: AREA_AT.x + 10, y: AREA_AT.y, z: AREA_AT.z },
                  ],
                }
              : {}),
          }),
      ...over,
    },
    supply(),
  );
};

/**
 * The same scene with Initiative rolled, for the spells that need a turn order.
 *
 * A rider deadline anchored to a turn cannot be pinned outside combat, and the
 * casting is **asked** for one before anything is spent rather than refused
 * after the fact — so a spell that hangs one cannot be cast off `SETUP` at
 * all. SRD Ray of Enfeeblement is the first tracked spell to write one: "the
 * next attack roll it makes until the start of your next turn".
 *
 * **Derived from the definition, not listed by spell id**, which is the rule
 * the area point and the wall path above already follow: the next tracked
 * spell that hangs a turn-anchored rider needs no line here.
 */
const IN_A_FIGHT: readonly GameEvent[] = [
  ...SETUP,
  {
    type: 'combat-started',
    combatants: [
      { id: WIZARD, initiative: 20, speed: 30 },
      { id: ALLY, initiative: 10, speed: 30 },
      { id: FOE, initiative: 5, speed: 30 },
    ],
  },
];

/** Which of the two a tracked spell is cast off. */
const logFor = (spellId: string): readonly GameEvent[] =>
  riderDurations(SRD_CONTENT.spell(spellId)!).some(
    (lasts: RiderDuration) => typeof lasts === 'string',
  )
    ? IN_A_FIGHT
    : SETUP;

const resolved = (spellId: string, over = {}, log: readonly GameEvent[] = logFor(spellId)) =>
  unwrap(cast(spellId, over, log), spellId);

/**
 * A tracked spell driven all the way to the `spell-cast` that records it.
 *
 * Most of the bucket settles in one breath and this is `resolved` for them.
 * **Twelve take a minute or more**, and a casting of a minute or more is a
 * *declared* one: `resolveSpell` writes `spell-declared` and stops, the clock
 * has to reach the moment the rite finishes, and `resolveDeclaredCast` settles
 * it under the casting id. So the sweeps below drive the whole casting rather
 * than asserting on half of one — which is the honest generalisation, because
 * what they claim is that every tracked spell is *cast* rather than refused.
 *
 * The span is the definition's own `castingSeconds`, which the oracle holds
 * against the printed casting time, so the clock is moved by the number the
 * book prints rather than by one this fixture chose.
 */
const driven = (spellId: string, log: readonly GameEvent[] = logFor(spellId)) => {
  const definition = SRD_CONTENT.spell(spellId)!;
  const first = resolved(spellId, {}, log);
  if (definition.castingTime !== 'long') return first;

  const open = fold('seed', [...log, ...first.events]);
  const castingId = pendingCastingsOf(open)[0]!.castingId;
  const tick = unwrap(advanceTime(open, definition.castingSeconds!, 'the rite'), `tick ${spellId}`);
  const ticked = [...log, ...first.events, ...tick];
  const settled = unwrap(
    resolveDeclaredCast(fold('seed', ticked), castingId, supply()),
    `settle ${spellId}`,
  );
  return {
    ...settled,
    events: [...first.events, ...tick, ...settled.events],
    unverified: [...first.unverified, ...settled.unverified],
  };
};

describe('a tracked spell is cast, not refused', () => {
  it.each(TRACKED.map((s) => [s] as const))('casts %s', (spellId) => {
    const out = driven(spellId);
    expect(out.events.filter((e) => e.type === 'spell-cast')).toHaveLength(1);
  });

  /**
   * And the twelve that take a minute or more are declared first, which is the
   * whole of what a long casting time changes about the bucket. Asserted here
   * rather than left implicit in the helper, because a `driven` that silently
   * stopped declaring would make the sweep above pass for the wrong reason.
   */
  it('declares the casting for every tracked spell that takes a minute or more', () => {
    const long = TRACKED.filter((spellId) => SRD_CONTENT.spell(spellId)?.castingTime === 'long');
    expect(long.length).toBeGreaterThan(0);
    for (const spellId of long) {
      const declaration = resolved(spellId);
      expect(declaration.events.some((e) => e.type === 'spell-declared'), spellId).toBe(true);
      expect(declaration.events.some((e) => e.type === 'spell-cast'), spellId).toBe(false);
    }
  });

  /** The cost is the whole point: a slot spent is a slot gone. */
  it('spends the slot a levelled tracked spell costs', () => {
    const out = resolved('fly');
    const after = fold('seed', [...SETUP, ...out.events]);
    expect(remaining(after.creatures.wizard!.resources, spellSlotKey(3))).toBe(3);
  });

  /** SRD Fly: "Concentration, up to 10 minutes". */
  it('takes Concentration, and gives up whatever was held', () => {
    const first = resolved('fly');
    const log = [...SETUP, ...first.events];
    expect(fold('seed', log).creatures.wizard!.concentration).not.toBeNull();

    const second = resolved('spider-climb', {}, log);
    expect(second.events.some((e) => e.type === 'concentration-ended')).toBe(true);
  });

  /** And a tracked spell that is *not* Concentration does not take it. */
  it('leaves Concentration alone for a spell that does not need it', () => {
    const held = [...SETUP, ...resolved('fly').events];
    const out = resolved('longstrider', {}, held);
    expect(out.events.some((e) => e.type === 'concentration-ended')).toBe(false);
    expect(fold('seed', [...held, ...out.events]).creatures.wizard!.concentration).not.toBeNull();
  });

  /** SRD Misty Step: "Bonus Action". A turn holds one of those, not two. */
  it('spends the action the spell actually costs', () => {
    expect(SRD_CONTENT.spell('misty-step')?.castingTime).toBe('bonus-action');
    expect(SRD_CONTENT.spell('jump')?.castingTime).toBe('bonus-action');
    expect(SRD_CONTENT.spell('fly')?.castingTime).toBe('action');
  });

  /**
   * Every one of these says what it is leaving to the table. A tracked spell
   * that declared nothing would be a definition that silently did nothing,
   * which is worse than the refusal it replaced.
   */
  it.each(TRACKED.map((s) => [s] as const))('says what a DM still does for %s', (spellId) => {
    const out = driven(spellId);
    expect(out.unverified.length).toBeGreaterThan(0);
    expect(out.unverified.join(' ')).toContain(SRD_CONTENT.spell(spellId)!.name);
  });

  it('affects nobody mechanically, and says so rather than pretending', () => {
    const out = resolved('detect-magic');
    expect(out.outcomes).toEqual([]);
  });
});

describe('a tracked spell still obeys its target rule', () => {
  /** SRD Detect Magic: "Range: Self". There is nobody to aim it at. */
  it('refuses a target for a spell that takes none', () => {
    const out = cast('detect-magic', { targets: [ALLY] });
    expect(isErr(out)).toBe(true);
    if (!isErr(out)) return;
    expect(out.code).toBe('takes_no_target');
  });

  /** SRD Fly: "You touch a willing creature." One, and it is not nobody. */
  it('refuses no target for a spell that needs one', () => {
    const out = cast('fly', { targets: [] });
    expect(isErr(out)).toBe(true);
    if (!isErr(out)) return;
    expect(out.code).toBe('no_targets');
  });

  /** SRD Fly: "one additional creature for each spell slot level above 3." */
  it('takes an extra target per slot level above the spell’s own', () => {
    const two = cast('fly', { targets: [ALLY, FOE] });
    expect(isErr(two)).toBe(true);
    if (isErr(two)) expect(two.code).toBe('too_many_targets');

    const out = unwrap(cast('fly', { targets: [ALLY, FOE], slotLevel: 4 }), 'fly at 4');
    expect(out.castingId!.length).toBeGreaterThan(0);
  });

  /** SRD Water Breathing: "up to ten willing creatures of your choice". */
  it('reads a ten-target spell as a ten-target spell', () => {
    expect(SRD_CONTENT.spell('water-breathing')?.targets.count).toBe(10);
  });

  /** Range is checked, because range is arithmetic even when the effect is not. */
  it('refuses a target out of range', () => {
    const far: readonly GameEvent[] = [
      ...SETUP.filter(
        (e) => !(e.type === 'creature-placed' && e.id === ALLY),
      ),
      { type: 'creature-placed', id: ALLY, placement: { from: { creature: WIZARD }, feet: 60, bearing: 0 } },
    ];
    const out = cast('fly', {}, far);
    expect(isErr(out)).toBe(true);
    if (!isErr(out)) return;
    expect(out.code).toBe('out_of_range');
  });
});

describe('a tracked spell is retried and replayed like any other', () => {
  it('is a no-op on a retried command id', () => {
    const first = resolved('fly', { commandId: 'c1' });
    const log = [...SETUP, ...first.events];
    const again = unwrap(cast('fly', { commandId: 'c1' }, log), 'retry');
    expect(again.events).toEqual([]);
    expect(remaining(fold('seed', log).creatures.wizard!.resources, spellSlotKey(3))).toBe(3);
  });

  it.each(TRACKED.map((s) => [s] as const))('replays %s prefix by prefix', (spellId) => {
    const out = driven(spellId);
    const log = [...SETUP, ...out.events];
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });

  /** No dice are rolled, so the generator does not move. */
  it('advances no roll for a spell that rolls nothing', () => {
    const out = resolved('detect-magic');
    expect(out.events.some((e) => e.type === 'rolls-issued')).toBe(false);
  });
});

/**
 * The markers, the vocabulary and the adjudications, all moved out.
 *
 * They live in `scripts/missing-shapes.ts` with the executed and undefined
 * populations' maps, because a shape all three name — `speed-and-movement-modes`
 * is the one — counted three spells short while this map was private. Every
 * guard over the tracked bucket is still here; the one that could not stay,
 * "no shape sits unclaimed", is in `blocked-on.test.ts`, because asked of this
 * map alone it would delete every shape only the other two populations name.
 *
 * The two ids this bucket used to own privately were `jumping` and
 * `teleportation`. Both moved into the shared vocabulary, and `jumping` has
 * since been **retired**: SRD Jump's 2024 sentence prints two flat numbers and
 * a cap rather than the multiplier the older one did, so the spell that was
 * the shape's last claimant is executed and the id names no gap.
 */

/**
 * The SRD's own prose for every spell.
 *
 * Read off disk rather than out of `@ie/srd`: `SPELL_INDEX` carries a spell's
 * id, level, school and class list and deliberately **not** its description,
 * because the engine is pure and cannot read a file at runtime. A test can, and
 * `coverage.test.ts` already does the same thing for the same reason. What is
 * being checked here is the book; a summary written in this repository would
 * only be checking the summary.
 */
const PROSE: ReadonlyMap<string, string> = new Map(
  (
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../srd/src/generated/spells.json', import.meta.url)),
        'utf8',
      ),
    ) as readonly { id: string; description: string; higherLevel?: string }[]
  ).map((spell) => [spell.id, `${spell.description}\n${spell.higherLevel ?? ''}`]),
);

/**
 * Every spell the book prints, which is the population the marker list is
 * honestly measured against — see the bound below.
 */
const PARSED: readonly string[] = [...PROSE.keys()].sort();

/**
 * The mechanical clauses the SRD's own text for this spell contains.
 *
 * Through `mechanicalMarkersIn` rather than by filtering `MECHANICAL_MARKERS`
 * here: this file used to hold the only copy of that expression, and the day a
 * tracked entry was allowed to say *no marker sees this sentence* there were
 * two — one deciding whether an entry may be filed marker-less, and this one
 * deciding whether the book trips anything. Two copies of that question is how
 * the marker-less form becomes a hole.
 */
const markersIn = (spellId: string): readonly MarkerId[] => {
  const text = PROSE.get(spellId);
  if (text === undefined) throw new Error(`${spellId} is not in the parsed SRD`);
  return mechanicalMarkersIn(text);
};

describe('a tracked spell may not hide a rule the engine owns', () => {
  it('has markers that actually fire, so the rule below is not vacuous', () => {
    // Spells this batch deliberately refused, each for one of these reasons.
    expect(markersIn('barkskin')).toContain('armor-class');
    expect(markersIn('magic-missile')).toContain('dice');
    expect(markersIn('greater-invisibility')).toContain('condition');
    expect(markersIn('power-word-kill')).toContain('hit-points');
    expect(markersIn('stoneskin')).toContain('defence');
    expect(markersIn('blur')).toContain('roll-mode');
    expect(markersIn('dispel-magic')).toContain('ability-check');
    expect(markersIn('divination')).toContain('chance');
    expect(markersIn('tree-stride')).toContain('movement-cost');
  });

  /**
   * The markers do not fire on everything, which is what keeps the rule below
   * from being a demand that every tracked spell be justified sentence by
   * sentence.
   *
   * ### The bound was measuring the wrong population, and it was never going
   * to stop moving
   *
   * This was `clean.length > TRACKED.length * 0.37` over the **tracked
   * bucket**, and it had already been moved once, from 45 per cent, with a
   * docstring saying it "has to be restated whenever the catalogue moves".
   * That sentence is the defect rather than the caveat. A share taken over
   * the tracked bucket measures **the order the catalogue was written in**,
   * not whether the marker list over-fires: the bucket was built easy end
   * first, so every later pass adds denominators and almost no numerators,
   * and the only way to keep it green is to lower it again. A guard that has
   * to be edited every time somebody does the work it is guarding is not
   * guarding anything.
   *
   * ### And the measurement says it is unreachable, not merely tight
   *
   * Over all 339 parsed spells, 71 paragraphs trip no marker. **Every one of
   * those 71 is already tracked or still undefined; the executed bucket holds
   * none at all** — which is not a coincidence, because a spell with nothing
   * mechanical in its text is exactly a spell with nothing to execute. So the
   * numerator of the old ratio is all but spent: three clean paragraphs are
   * left in the whole book, one of them is Darkness and is held back by a
   * decision rather than by transcription, and the denominator has the whole
   * mechanically dense tail still to come. A finished catalogue could not
   * satisfy 37 per cent however it was written.
   *
   * ### So it is re-pointed rather than lowered
   *
   * The claim — "the marker list does not fire on every paragraph in the
   * book" — is about the **book**, and the book is a fixed population that a
   * definition cannot move. A fifth of it trips nothing, and that number
   * changes only when the markers change or the SRD is re-ingested, which are
   * precisely the two events this guard should catch and the two it used to
   * be unable to distinguish from somebody writing a spell. The floor sits
   * three spells under the measurement, where the old one sat 3.6 under a
   * measurement that fell every pass.
   *
   * The tracked bucket keeps the two claims that are honestly about it: some
   * of it is clean and not all of it is. Neither can be satisfied by choosing
   * which spells to write next.
   */
  it('leaves a fifth of the book with nothing mechanical to explain', () => {
    const book = PARSED.filter((spellId) => markersIn(spellId).length === 0);
    expect(book.length).toBeGreaterThan(PARSED.length * 0.2);
    expect(book.length).toBeLessThan(PARSED.length);
  });

  /**
   * The fact that makes the bound above the right one, pinned rather than
   * asserted in prose: **an executed spell has a clean paragraph only where
   * this list has no pattern for the mechanic it executes.**
   *
   * It read "never", and one spell now says otherwise. Expeditious Retreat's
   * whole printed text is the action economy — "You take the Dash action, and
   * until the spell ends, you can take that action again as a Bonus Action" —
   * and {@link MECHANICAL_MARKERS} holds no action-economy pattern, because it
   * was derived from the mechanics a *tracked* spell hides and a spell that
   * hides the action economy behind a condition was not one of them. So the
   * paragraph reads clean to this list and is executed by an `action-rule`
   * grant all the same. `CLAUSE_MARKERS`, the executed population's own list,
   * fires on it through `action-economy`, which is why the honesty guard over
   * there is not fooled and the exemption is safe.
   *
   * **The re-pointing above is unaffected**, which is the thing worth checking
   * rather than the wording. That bound is taken over the whole parsed book,
   * which no definition can move; what this supports is the narrower claim that
   * a clean paragraph is usually a spell with nothing to execute, and the
   * exception is named rather than the rule loosened.
   *
   * **And three more say otherwise now, for one reason each.**
   *
   * Magic Weapon's whole printed text is "a +1 bonus to attack rolls and
   * damage rolls" and the two bands a higher slot buys, and
   * {@link MECHANICAL_MARKERS} holds no pattern for an attack roll or for a
   * bare mention of damage — `extra-damage` wants the word "extra" and `dice`
   * wants a notation, and the spell prints neither.
   *
   * Darkness, Daylight and Fog Cloud read clean for the neighbouring reason,
   * which this list's neighbour at the top of the file already records: the
   * book writes Bright Light, Dim Light, Darkness and Heavily Obscured in none
   * of the words that list knows, because it was derived from the mechanics a
   * *tracked* spell hides and light was not one of them. They are executed by
   * a patch on the lattice all the same.
   *
   * `CLAUSE_MARKERS`, the executed population's own list, is fooled by none of
   * the four — it fires through `attack-roll` and `damage` on the first and on
   * the light clauses of the rest — which is why the honesty guard over there
   * is what actually holds their paragraphs to account, and why these
   * exemptions are safe.
   */
  const CLEAN_AND_EXECUTED: readonly string[] = [
    // The Mask, whose paragraph names no mechanic any marker knows: a creature
    // type is a fact rather than a die, a condition or a bonus, and the word
    // the sentence turns on is "treat".
    'arcanists-magic-aura',
    // The light the sight track carried out of the tracked bucket: Light and
    // Continual Flame shed from what their bearer holds, Dancing Lights from a
    // point its Bonus Action moves, and Darkvision confers the sense.
    'continual-flame',
    'dancing-lights',
    'darkness',
    'darkvision',
    'daylight',
    'expeditious-retreat',
    // And the fifth kind of clean paragraph: SRD Feather Fall's prints a
    // descent rate, a landing and a spell ending, and the marker list knows
    // none of those words — `speed` is `Speed` with a capital and this says
    // "rate of descent". The ward it hangs is executed all the same.
    'feather-fall',
    'fog-cloud',
    'light',
    'magic-weapon',
    // And the three the casting track carried out. Every one of
    // Prestidigitation's six wonders is fiction, and the sentence over them —
    // three of its non-instantaneous effects at a time — is a rule the engine
    // applies at the cast. Remove Curse reads clean for the neighbouring
    // reason: a curse is fiction, an Attunement is not, and no marker knows
    // the word Attunement. No marker knows those words either.
    'prestidigitation',
    'remove-curse',
  ];

  it('finds every clean paragraph outside the executed bucket', () => {
    const executed = SPELL_DEFINITIONS.filter(
      (d) => !TRACKED.includes(d.id) && PROSE.has(d.id),
    ).map((d) => d.id);
    expect(executed.length).toBeGreaterThan(100);
    expect(executed.filter((spellId) => markersIn(spellId).length === 0)).toEqual([
      ...CLEAN_AND_EXECUTED,
    ]);
  });

  /** And the tracked bucket is neither all clean nor all mechanical. */
  it('holds tracked spells on both sides of the marker list', () => {
    const clean = TRACKED.filter((spellId) => markersIn(spellId).length === 0);
    expect(clean.length).toBeGreaterThan(0);
    expect(clean.length).toBeLessThan(TRACKED.length);
  });

  /**
   * The demand, asked through {@link unansweredMarkers} rather than restated.
   *
   * A marker-less entry answers **no** marker, which is what keeps the entry
   * form from being a way out of this rule: a spell whose prose trips the
   * condition marker owes a `condition` entry whether or not somebody also
   * wrote down a sentence the markers cannot see.
   * `marker-less-blockers.test.ts` drives that with a synthetic built to fail.
   */
  it.each(TRACKED.map((s) => [s] as const))(
    'has a written adjudication for every mechanical clause in %s',
    (spellId) => {
      expect(
        unansweredMarkers(spellId),
        `${spellId} has a clause with no adjudication`,
      ).toEqual([]);
      for (const entry of ADJUDICATED[spellId] ?? []) {
        expect(entry.note.length, `${spellId}/${entry.clause}`).toBeGreaterThan(40);
      }
    },
  );

  /**
   * A stale exemption is the same failure wearing the other face: a spell that
   * once had a clause, no longer does, and keeps a licence for it.
   *
   * A marker-less entry is exempt from *this* one and from nothing else, for
   * the reason it exists: it names no marker, so there is no marker for the
   * book to have stopped printing. What holds it instead is the anchoring
   * guard below, which is stricter — the unit it names must still be there and
   * must still trip nothing.
   */
  it('carries no adjudication for a clause the book does not contain', () => {
    for (const [spellId, written] of Object.entries(ADJUDICATED)) {
      const found = new Set<string>(markersIn(spellId));
      expect(
        written
          .map((entry) => entry.marker)
          .filter((marker) => marker !== null && !found.has(marker)),
        spellId,
      ).toEqual([]);
    }
  });

  /** And every adjudicated spell is one the catalogue actually tracks. */
  it('adjudicates only spells that are tracked', () => {
    expect(Object.keys(ADJUDICATED).filter((id) => !TRACKED.includes(id))).toEqual([]);
  });

  /**
   * A clause names one sentence the spell prints, and that sentence names the
   * mechanic beside it.
   *
   * This map was keyed by marker until IE-044 and so said *which mechanic* and
   * never *which sentence* — one adjudication per marker, anchored to the
   * paragraph as a whole. That is the same defect the undefined population had:
   * a licence written about a rule the spell states somewhere, with nothing
   * saying where. The phrase is held to `Adjudication.clause`'s rule through
   * the same implementation, and to one rule more, because a marker-keyed map
   * can afford it: the sentence the phrase sits in must trip that marker, so an
   * adjudication cannot be written about a neighbouring clause.
   */
  it('anchors every adjudication to a sentence that names its marker', () => {
    for (const spellId of Object.keys(ADJUDICATED)) {
      expect(misanchoredAdjudications(spellId), spellId).toEqual([]);
    }
  });

  /**
   * And the entry form that says *the markers see nothing here*.
   *
   * It exists because they are a floor: a rule the SRD phrases in none of
   * their words trips nothing, is demanded of nobody, and used to be **dropped
   * on the way out of `BLOCKED_ON`** — after which the unclaimed-shape guard
   * demanded the shape be retired, deleting a gap that is still real. Three
   * definitions were reverted over that rather than shipped and all three are
   * in the catalogue now.
   *
   * What is asserted here is that the form is in use and that it is a **claim
   * or a handover** rather than a comment: each one names a shape one of the
   * three vocabularies has, or says `'table'`. Speak with Animals is the
   * first to reach past the spell book: what blocks it is the Influence
   * action, which is a gap the **feature** vocabulary already describes. Its two refusals — a sentence a
   * marker can see, and an `'engine'` or `'expressible'` claim nobody can
   * re-run — are held by `misanchoredAdjudications` above and driven with
   * synthetics in `marker-less-blockers.test.ts`.
   *
   * **`'table'` was refused here until gate G1**, and the thirty-four spells
   * below are why it is not: they are the tracked spells in level-5 reach
   * whose prose trips no marker anywhere, so a marker-less entry is the only
   * entry any of them can have — and `trackedAdjudicationGaps` now demands one
   * of every tracked definition that prints an `unmodelled` line.
   */
  it('records the blockers no marker could have demanded', () => {
    const markerLess = Object.entries(ADJUDICATED).flatMap(([spellId, written]) =>
      written.filter((entry) => entry.marker === null).map((entry) => [spellId, entry] as const),
    );
    expect(markerLess.length).toBeGreaterThan(0);
    const known = new Set<string>([
      ...Object.keys(MISSING_SHAPES),
      ...Object.keys(ITEM_SHAPES),
      ...Object.keys(FEATURE_SHAPES),
      'table',
    ]);
    for (const [spellId, entry] of markerLess) {
      expect([...known], `${spellId}: "${entry.clause}"`).toContain(entry.why);
    }
    // And the form still carries readings a marker could never have demanded,
    // which is the reason it exists rather than a by-product of the widening.
    expect(
      markerLess.filter(([, entry]) => entry.why !== 'table').length,
    ).toBeGreaterThan(0);
  });

  /**
   * And the cap the record imposed is gone rather than merely unused: the type
   * permits a spell two adjudications for one marker, which the SRD asks for —
   * Tree Stride spends 5 feet of movement in three sentences and Plane Shift
   * teleports two different ways. Nothing writes a second one yet, so the claim
   * is that the storage allows it rather than that something uses it.
   */
  it('permits a spell more than one adjudication for one marker', () => {
    const doubled: Readonly<Record<string, readonly TrackedAdjudication[]>> = {
      'tree-stride': [
        {
          marker: 'movement-cost',
          clause: 'You must use 5 feet of movement to enter a tree',
          why: 'table',
          note: 'a synthetic entry: the storage the record could not hold.',
        },
        {
          marker: 'movement-cost',
          clause: 'using another 5 feet of movement',
          why: 'table',
          note: 'the second sentence of the same paragraph spending the same feet.',
        },
      ],
    };
    expect(doubled['tree-stride']).toHaveLength(2);
    // And both are real sentences of that spell, so the case is one the book
    // asks for rather than one invented to make the type look wider.
    expect(
      unanchoredPhrases(
        'tree-stride',
        (doubled['tree-stride'] ?? []).map((entry) => entry.clause),
      ),
    ).toEqual([]);
  });

  /**
   * The half that makes this more than a comment box: a clause that is *not*
   * the table's, the engine's or expressible must name an enumerated missing
   * shape. Adding one means adding to a list, which is the visible act this
   * test exists to force.
   *
   * **Either list**, since gate G1: Remove Curse's Attunement clause is a debt
   * whose shape is the item vocabulary's and finishes on that very sentence,
   * and minting a second id here for one gap is the duplication that
   * vocabulary was split out to avoid.
   */
  it('names an enumerated shape for every clause that is not the table’s', () => {
    const known = [
      ...Object.keys(MISSING_SHAPES),
      ...Object.keys(ITEM_SHAPES),
      ...Object.keys(FEATURE_SHAPES),
    ];
    for (const [spellId, written] of Object.entries(ADJUDICATED)) {
      for (const entry of written) {
        if (entry.why === 'table' || entry.why === 'engine') continue;
        if (entry.why === 'expressible') continue;
        expect(known, `${spellId}/${entry.marker}`).toContain(entry.why);
      }
    }
  });

  /**
   * A solved shape may not linger in the map pretending to be missing.
   *
   * The opposite failure from the dumping ground and just as dishonest: an
   * ability check against a spell save DC was a named blocker until
   * `resolveEffectCheck` landed, and a map that still listed it would send the
   * next reader off to build something that already exists.
   */
  it('has retired the shapes that were solved', () => {
    expect(Object.keys(MISSING_SHAPES)).not.toContain('check-against-spell-save-dc');
    expect(
      Object.values(ADJUDICATED).flatMap((written) => written.map((entry) => entry.why)),
    ).toContain('engine');
  });

  /**
   * `'engine'` has to be true, and this is the half that can check it.
   *
   * Found by mutation: relabelling Disguise Self's Investigation check as the
   * table's passed everything, because a written reason is only as honest as
   * whoever wrote it. But *this* claim is not a matter of opinion — a spell
   * that executes a check carries one in its definition — so both directions
   * are asserted. A definition with a check must say `engine`, and a spell
   * claiming `engine` must have something that actually runs.
   */
  it('says engine for exactly the checks the catalogue really executes', () => {
    for (const spellId of TRACKED) {
      const executes = SRD_CONTENT.spell(spellId)?.check !== undefined;
      const claimed =
        (ADJUDICATED[spellId] ?? []).find((entry) => entry.marker === 'ability-check')?.why ===
        'engine';
      expect(claimed, `${spellId}: check=${executes}, claims engine=${claimed}`).toBe(executes);
    }
  });

  /** A note that says nothing is a licence, so each must be specific. */
  it('writes a real sentence for every adjudication', () => {
    for (const [spellId, written] of Object.entries(ADJUDICATED)) {
      for (const entry of written) {
        expect(entry.note.length, `${spellId}/${entry.marker}`).toBeGreaterThan(40);
      }
    }
  });

  /**
   * "No shape sits unclaimed" is in `blocked-on.test.ts` now, over all three
   * populations at once. Asked of this map alone it would delete every shape
   * only an executed or an undefined spell names, which is all but three.
   * What stays is the half about *this* map: a shape it names is one the
   * vocabulary has.
   */
  it('names no shape the vocabulary does not have', () => {
    const known = new Set<string>([
      ...Object.keys(MISSING_SHAPES),
      ...Object.keys(ITEM_SHAPES),
      ...Object.keys(FEATURE_SHAPES),
    ]);
    for (const [spellId, written] of Object.entries(ADJUDICATED)) {
      for (const entry of written) {
        if (entry.why === 'table' || entry.why === 'engine') continue;
        if (entry.why === 'expressible') continue;
        expect(known.has(entry.why), `${spellId}/${entry.marker}`).toBe(true);
      }
    }
  });
});

describe('a tracked spell runs its duration on the clock', () => {
  /** SRD Tongues: "Duration: 1 hour", and no Concentration to hold it up. */
  it('schedules the casting’s own deadline and lets it run out', () => {
    const out = resolved('tongues');
    const log = [...SETUP, ...out.events];

    const running = fold('seed', log);
    expect(Object.keys(running.timers)).toHaveLength(1);

    const almost = fold('seed', [
      ...log,
      { type: 'time-advanced', seconds: 3599, reason: 'the party walks' },
    ]);
    expect(Object.keys(almost.timers)).toHaveLength(1);

    const expired = fold('seed', [
      ...log,
      { type: 'time-advanced', seconds: 3600, reason: 'the party walks' },
    ]);
    expect(Object.keys(expired.timers)).toHaveLength(0);
  });

  /**
   * SRD Arcane Lock: "Duration: Until dispelled." There is no deadline to
   * schedule, and the definition says so rather than inventing one — a tracked
   * spell with a wrong duration is exactly as wrong as an executed one with
   * wrong dice, and nothing downstream would catch it.
   */
  it('schedules nothing for a spell that never runs out', () => {
    const out = resolved('arcane-lock');
    const after = fold('seed', [...SETUP, ...out.events]);
    expect(Object.keys(after.timers)).toHaveLength(0);
    expect(SRD_CONTENT.spell('arcane-lock')?.durationSeconds).toBeUndefined();
  });

  /** Every tracked duration is a whole number of seconds the SRD actually prints. */
  it('gives Message one round, which is six seconds', () => {
    expect(SRD_CONTENT.spell('message')?.durationSeconds).toBe(6);
  });
});

describe('a tracked spell spends the turn’s action like any other casting', () => {
  const inCombat: readonly GameEvent[] = [
    ...SETUP,
    {
      type: 'combat-started',
      combatants: [
        { id: WIZARD, initiative: 20, speed: 30 },
        { id: ALLY, initiative: 10, speed: 30 },
        { id: FOE, initiative: 5, speed: 30 },
      ],
    },
  ];

  /** SRD: "Most spells require the Magic action to cast." One per turn. */
  it('takes the Action, and refuses a second Action spell on the same turn', () => {
    const first = resolved('locate-object', {}, inCombat);
    const log = [...inCombat, ...first.events];
    expect(fold('seed', log).combat?.budgets.wizard?.action).toBe(false);

    // A cantrip, so what refuses it is the Action being gone rather than the
    // turn's one spell slot. Two different rules; this test is about the first.
    const second = cast('message', {}, log);
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.code).toBe('no_action');
  });

  /**
   * SRD: "On a turn, you can expend only one spell slot to cast a spell." A
   * tracked spell's slot is a real slot, so it uses that turn's one up.
   */
  it('uses up the turn’s one slot', () => {
    const first = resolved('tongues', {}, inCombat);
    const log = [...inCombat, ...first.events];
    const second = cast('knock', {}, log);
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.code).toBe('slot_already_spent_this_turn');
  });
});

describe('what a tracked spell leaves to the table reaches the table', () => {
  /**
   * Not "some note came back" — the note this definition actually wrote,
   * verbatim, prefixed with the spell's name so a narrating layer can attribute
   * it. A docstring nobody at the table reads is not a disclosure.
   */
  it('reports the definition’s own sentences, word for word', () => {
    const out = resolved('wall-of-force');
    for (const gap of SRD_CONTENT.spell('wall-of-force')!.unmodelled ?? []) {
      expect(out.unverified).toContain(`Wall of Force: ${gap}`);
    }
  });

  /** And it says it on a retried-then-replayed casting too, not only the first. */
  it('reports it for a casting resolved out of a fresh fold', () => {
    const first = resolved('nondetection', { commandId: 'nd-1' });
    const log = [...SETUP, ...first.events];
    const again = resolved('nondetection', { commandId: 'nd-2' }, log);
    expect(again.unverified.length).toBeGreaterThan(0);
  });

  /**
   * A retry of a levelled tracked spell spends one slot, not two. The whole
   * reason the tracked bucket exists is that the cost is real, and a cost that
   * doubles on a dropped connection is worse than no cost at all.
   */
  it('spends one slot across a retried command id', () => {
    const first = resolved('demiplane', { commandId: 'dp-1' });
    const log = [...SETUP, ...first.events];
    expect(remaining(fold('seed', log).creatures.wizard!.resources, spellSlotKey(8))).toBe(3);

    const again = unwrap(cast('demiplane', { commandId: 'dp-1' }, log), 'retry');
    expect(again.events).toEqual([]);
    expect(again.castingId).toBe(first.castingId);
  });
});

describe('a tracked spell’s target rule is the SRD’s, not a placeholder', () => {
  /** SRD Word of Recall: "up to five willing creatures within 5 feet of you." */
  it('checks a five-foot range per target', () => {
    const far: readonly GameEvent[] = [
      ...SETUP.filter((e) => !(e.type === 'creature-placed' && e.id === ALLY)),
      {
        type: 'creature-placed',
        id: ALLY,
        placement: { from: { creature: WIZARD }, feet: 10, bearing: 0 },
      },
    ];
    const out = cast('word-of-recall', {}, far);
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('out_of_range');
  });

  /** SRD Plane Shift: "You and up to eight willing creatures" — eight, not nine. */
  it('counts the caster separately where the SRD does', () => {
    expect(SRD_CONTENT.spell('plane-shift')?.targets.count).toBe(8);
    expect(SRD_CONTENT.spell('plane-shift')?.targets.self).toBeUndefined();
  });

  /** SRD Tongues: "the creature you touch" — which may be you. */
  it('lets a spell be cast on yourself when the SRD allows it', () => {
    const out = unwrap(cast('tongues', { targets: [WIZARD] }), 'tongues on self');
    expect(out.events.filter((e) => e.type === 'spell-cast')).toHaveLength(1);
  });

  /** SRD Plane Shift takes the creatures with you, so the caster is not a target. */
  it('refuses the caster where the SRD counts them separately', () => {
    const out = cast('plane-shift', { targets: [WIZARD] });
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('cannot_target_self');
  });
});

/**
 * The spells this batch added, driven one at a time as well as swept.
 *
 * Every sweep above is parameterised over whatever the catalogue happens to
 * hold, which is what makes them worth keeping and what makes them useless as
 * the *first* test of a definition: a spell that does not exist is a spell no
 * sweep has an entry for, so a catalogue that never gained one of these would
 * go green. This list is written out for the reason `blocked-on.test.ts`
 * writes out the set blocked on nothing — a spell joining or leaving it is
 * somebody's decision, and it should have to say so here.
 *
 * What each is asserted to do is what a **tracked** definition is for: the
 * slot goes, the action the book prints goes, Concentration moves exactly
 * where the printed Duration says it does, the clock runs the span the book
 * prints, and the table is told what it is being left to decide. Anything
 * further is that spell's own test.
 */
const ADDED_FIRST: readonly string[] = [
  'aid',
  'animal-messenger',
  'antilife-shell',
  'arcane-eye',
  'arcanists-magic-aura',
  'barkskin',
  'command',
  'create-or-destroy-water',
  'daylight',
  'death-ward',
  'druidcraft',
  'elementalism',
  'enhance-ability',
  'expeditious-retreat',
  'faerie-fire',
  'faithful-hound',
  'flaming-sphere',
  'fog-cloud',
  'forcecage',
  'foresight',
  'freedom-of-movement',
  'glibness',
  'globe-of-invulnerability',
  'goodberry',
  'greater-restoration',
  'guardian-of-faith',
  'heat-metal',
  'holy-aura',
  'ice-knife',
  'major-image',
  'mass-heal',
  'meld-into-stone',
  'mirror-image',
  'pass-without-trace',
  'polymorph',
  'purify-food-and-drink',
  'ray-of-enfeeblement',
  'resistance',
  'reverse-gravity',
  'sanctuary',
  'seeming',
  'sequester',
  'shapechange',
  'sleep',
  'sleet-storm',
  'speak-with-plants',
  'spike-growth',
  'true-strike',
  'wall-of-fire',
  'warding-bond',
  'zone-of-truth',
];

/**
 * The second pass over the same ground, and it is a different population.
 *
 * `ADDED_FIRST` was written easy end first — the spells whose whole text is
 * fiction. What was left after it is the tail: every one of these was in
 * `BLOCKED_ON` naming a shape the engine really does not have, so each arrives
 * with its blocker quoted in `TRACKED_ADJUDICATED` rather than with an empty
 * paragraph. That is why the *clean* share below had to move and the rest of
 * this file did not: nothing about what a tracked definition owes changed, and
 * the share of tracked spells with a mechanical sentence in them did.
 *
 * Kept as a second list rather than merged into the first, because the claim
 * each makes is about a batch — "these are the spells this pass wrote" — and a
 * merged list would let a later pass add nothing and still look like the
 * others. Both are sorted and both are swept, which is what the sweeps care
 * about.
 */
const ADDED_SECOND: readonly string[] = [
  'alter-self',
  'animate-dead',
  'animate-objects',
  'augury',
  'aura-of-life',
  'awaken',
  'blade-barrier',
  'blink',
  'clone',
  'commune',
  'conjure-elemental',
  'contact-other-plane',
  'contingency',
  'control-weather',
  'create-undead',
  'creation',
  'divination',
  'dragons-breath',
  'fire-storm',
  'forbiddance',
  'geas',
  'guards-and-wards',
  'heroes-feast',
  'irresistible-dance',
  'magnificent-mansion',
  'meteor-swarm',
  'mislead',
  'phantom-steed',
  'planar-ally',
  'planar-binding',
  'plant-growth',
  'power-word-heal',
  'power-word-kill',
  'power-word-stun',
  'protection-from-evil-and-good',
  'raise-dead',
  'reincarnate',
  'revivify',
  'secret-chest',
  'silence',
  'teleportation-circle',
  'thaumaturgy',
  'time-stop',
  'true-resurrection',
  'unseen-servant',
  'wall-of-ice',
  'wall-of-stone',
  'wall-of-thorns',
  'wind-wall',
];

/**
 * The third pass, and the population is what the first two left.
 *
 * `ADDED_SECOND` said its ground was "the tail"; this is the end of it. Every
 * spell here was in `BLOCKED_ON` naming at least one shape the engine really
 * does not have — **the set blocked on nothing was empty of writable spells
 * after this pass**, and the two entries still in it were held back by
 * decisions rather than by transcription: Darkness, whose definition was
 * thought to make Sunburst's dispel clause reachable, and Programmed Illusion,
 * whose `untilDispelled` no `SpellCheck` can hang a duration on. Darkness is
 * `ADDED_SEVENTH` now and says there how the decision went.
 *
 * So the ordering was derived rather than chosen. Nothing in the undefined
 * population is waited on by an item or a feature, no pocket of expressible
 * effects is left, and what remains is the book from level 0 upward with ten
 * spells set aside for reasons written in the digest rather than re-derived
 * here.
 */
const ADDED_THIRD: readonly string[] = [
  'animal-shapes',
  'antimagic-field',
  'antipathy-sympathy',
  'arcane-hand',
  'astral-projection',
  'bestow-curse',
  'call-lightning',
  'confusion',
  'conjure-animals',
  'conjure-celestial',
  'conjure-minor-elementals',
  'control-water',
  'delayed-blast-fireball',
  'dispel-evil-and-good',
  'divine-word',
  'earthquake',
  'ensnaring-strike',
  'eyebite',
  'find-steed',
  'giant-insect',
  'glyph-of-warding',
  'hex',
  'imprisonment',
  'magic-circle',
  'magic-jar',
  'prismatic-spray',
  'prismatic-wall',
  'project-image',
  'simulacrum',
  'storm-of-vengeance',
  'summon-dragon',
  'symbol',
  'true-polymorph',
  'tsunami',
  'wind-walk',
];

/**
 * The fourth pass is three spells and no reading at all — the third pass had
 * already read them.
 *
 * Each of these was written, run and **reverted** on the pass that found the
 * defect: `TRACKED_ADJUDICATED` was keyed to a mechanical marker, so a spell
 * leaving `BLOCKED_ON` could only carry the blockers the markers can see in
 * English, and each of these three turns on one they cannot — a cantrip's
 * range doubling with caster level, a −10 that reaches one skill, a Construct
 * that succeeds automatically. The readings would have been dropped and the
 * unclaimed-shape guard would then have demanded three real gaps be retired,
 * which is worse than three spells going unwritten.
 *
 * `TrackedAdjudication.marker` may be null now, and these are the definitions
 * that were waiting on it. `marker-less-blockers.test.ts` holds the entry form
 * itself and asserts the counterfactual: hold the map to the old rule and
 * exactly these three shapes lose their last claimant.
 */
const ADDED_FOURTH: readonly string[] = ['enthrall', 'flesh-to-stone', 'spare-the-dying'];

/**
 * The fifth pass is the other two the same derivation named.
 *
 * The fourth pass shipped three of the spells the marker-less entry form
 * unblocked and the commit that shipped them named the **shapes** rather than
 * the spells: three shapes lose their last claimant when the tracked map is
 * held to the old rule. Two more spells sit behind exactly that sentence —
 * Calm Emotions, whose suppression clause is the sole claimant of
 * `a-condition-a-spell-suppresses`, and Hallow, whose refusal to overlap
 * another Hallow is the sole claimant of
 * `a-cap-on-how-many-castings-run-at-once`. Neither sentence trips a marker,
 * so neither spell could be written while an entry had to carry one, and
 * writing it anyway would have retired a gap that is still real.
 *
 * `marker-less-blockers.test.ts` asserts that as a counterfactual over the map
 * as it now stands: five shapes go, not three, and these are the two spells
 * the other two belong to.
 */
const ADDED_FIFTH: readonly string[] = ['calm-emotions', 'hallow'];

/**
 * The sixth pass is the two spells whose blocker was never a shape.
 *
 * Both sat in `BLOCKED_ON` **under protest**, and the protest was about a
 * printed Range the format has no kind for — `Special` for one and `Sight` for
 * the other. The entries said so in as many words: "No shape id names it, and
 * inventing one is an architecture decision rather than a reading."
 *
 * The decision went the other way. "Some text is the DM's alone ... Not a
 * format arm to invent, a handover to make visible": a Range that is a question
 * about the world is answered by the table, so the definition says
 * `range: { kind: 'dm' }`, `dmDecides` carries the book's own words out of
 * every casting, and the engine measures nothing and says why. Everything each
 * spell still owes is an ordinary shape and is filed in `ADJUDICATED` beside
 * every other tracked spell's.
 *
 * `dm-handover.test.ts` is where the handover itself is driven; these two are
 * here because a pass list is a record of what was written and when.
 */
const ADDED_SIXTH: readonly string[] = ['dream', 'mirage-arcane'];

/**
 * The seventh pass is one spell, and it is the one the third pass set aside.
 *
 * `ADDED_THIRD` said the set blocked on nothing was "empty of writable spells"
 * and named the two held back by a decision rather than by transcription.
 * Darkness was the first of them: writing it would make Sunburst's "dispels
 * Darkness in its area" reachable, and `spell-honesty.test.ts` pinned that
 * clause as the table's on the grounds that no Darkness casting existed.
 *
 * The decision went to the geometry. A `SpellArea` is what an effect is
 * resolved over and there is no effect here, so the fifteen-foot Sphere is
 * quoted to the table exactly as Daylight's sixty and Fog Cloud's twenty are —
 * which leaves Sunburst's clause the table's for a **different** absent fact,
 * and that test now pins the new one. Programmed Illusion is still waiting, on
 * `check_without_duration`, which is engine work.
 */
const ADDED_SEVENTH: readonly string[] = ['darkness'];

const ADDED: readonly string[] = [
  ...ADDED_FIRST,
  ...ADDED_SECOND,
  ...ADDED_THIRD,
  ...ADDED_FOURTH,
  ...ADDED_FIFTH,
  ...ADDED_SIXTH,
  ...ADDED_SEVENTH,
].sort();

/**
 * The spells whose door is **not** the casting command.
 *
 * SRD Divine Smite and SRD Searing Smite are cast on an attack that has hit,
 * and SRD True Strike is cast *as* one: `resolveSpell` refuses all three,
 * because the attack is the thing they need and that command has none to give.
 * Every sweep below that *casts* takes this out of its population, and the
 * refusal is asserted rather than the spell being quietly dropped — the reading
 * `spell-catalogue.test.ts` already takes of the same two effect kinds.
 *
 * Derived from the effect kinds rather than listed by spell id, so the next
 * definition written this way needs no line here.
 */
const castOnASwing = (spellId: string): boolean =>
  (SRD_CONTENT.spell(spellId)?.effects ?? []).some(
    (effect) => effect.kind === 'attack-damage' || effect.kind === 'weapon-attack',
  );

/** The passes above, less the spells this command cannot cast at all. */
const DRIVEN_HERE: readonly string[] = ADDED.filter((spellId) => !castOnASwing(spellId));

describe('every spell this batch added is cast for real', () => {
  it('names them in an order two branches can both append to', () => {
    expect(ADDED_FIRST).toEqual([...ADDED_FIRST].sort());
    expect(ADDED_SECOND).toEqual([...ADDED_SECOND].sort());
    expect(ADDED_THIRD).toEqual([...ADDED_THIRD].sort());
    expect(ADDED_FOURTH).toEqual([...ADDED_FOURTH].sort());
    expect(ADDED_FIFTH).toEqual([...ADDED_FIFTH].sort());
    expect(ADDED_SIXTH).toEqual([...ADDED_SIXTH].sort());
    expect(ADDED_SEVENTH).toEqual([...ADDED_SEVENTH].sort());
  });

  /** And the six batches are six batches: nothing is claimed by two. */
  it('keeps the six passes apart', () => {
    const passes = [
      ADDED_FIRST,
      ADDED_SECOND,
      ADDED_THIRD,
      ADDED_FOURTH,
      ADDED_FIFTH,
      ADDED_SIXTH,
      ADDED_SEVENTH,
    ];
    for (const [at, pass] of passes.entries()) {
      expect(pass.length, `pass ${at + 1}`).toBeGreaterThan(0);
      const others = passes.filter((_, other) => other !== at).flat();
      expect(pass.filter((id) => others.includes(id)), `pass ${at + 1}`).toEqual([]);
    }
  });

  /**
   * And each of the last two passes' five carries a blocker the markers cannot
   * see, which is the whole reason they are their own passes rather than part
   * of the third.
   */
  it('keeps a marker-less reading for every spell the last two passes added', () => {
    for (const spellId of [...ADDED_FOURTH, ...ADDED_FIFTH]) {
      const written = ADJUDICATED[spellId] ?? [];
      expect(
        written.filter((entry) => entry.marker === null).length,
        spellId,
      ).toBeGreaterThan(0);
    }
  });

  /**
   * Hallow writes three readings of one sentence **under one marker**, which is
   * the cap IE-044 lifted being spent rather than merely permitted.
   *
   * Three entries about one sentence is not the rare thing — Warding Bond files
   * an Armour Class, a saving throw and a Resistance against its one bonus
   * sentence, and each answers a different marker. What the record could not
   * hold is *this*: Hallow's Hallowed Ward is one sentence with three different
   * gaps in it — a predicate over creature type deciding who is caught, a
   * barrier nothing in a mover's path can refuse, and an Immunity narrowed both
   * to a cause and to a place — and all three trip the same `condition` marker,
   * so a map keyed by marker could keep exactly one of them. A test that only
   * asserted the type allows two would have gone on passing if the storage
   * quietly narrowed again.
   */
  it('files three readings of Hallow’s one warded sentence under one marker', () => {
    const printed = sentencesOf('hallow');
    const bySentence = new Map<string, TrackedAdjudication[]>();
    for (const entry of ADJUDICATED['hallow'] ?? []) {
      const sentence = printed.find((text) => text.includes(entry.clause));
      expect(sentence, entry.clause).toBeDefined();
      bySentence.set(sentence!, [...(bySentence.get(sentence!) ?? []), entry]);
    }
    const ward = [...bySentence.entries()].find(([sentence]) =>
      sentence.startsWith("Creatures of the chosen types can't willingly enter the area"),
    );
    expect(ward, 'no entry names the Hallowed Ward sentence').toBeDefined();
    expect([...(ward?.[1] ?? [])].map((entry) => entry.why).sort()).toEqual([
      'a-barrier-that-blocks-passage',
      'a-condition-immunity-narrowed-to-its-source',
      'a-creature-type-predicate-an-area-reads',
    ]);
    // The half the record could not hold: one marker, three readings. Without
    // this the assertion above is satisfied by three entries under three
    // different markers, which the map already allowed.
    expect([...new Set((ward?.[1] ?? []).map((entry) => entry.marker))]).toEqual(['condition']);
  });

  /**
   * **Three of these are executed now, and leaving by that door is not
   * leaving.**
   *
   * A pass list is a record of what was written and when, so a spell that has
   * since grown an effect may not simply be deleted from one — the list would
   * then say the third pass never wrote Wind Walk, which is false. It is
   * recorded here instead, which is the same move `SPLIT_BUNDLES` makes for a
   * clause whose shape was built: the row stays and says where it went.
   *
   * **Fifteen have gone out, by nine different doors**, which is why the test
   * below asks `isExecuted` rather than counting effects: a departure is "no
   * longer tracked", and there are nine ways to stop being tracked now rather
   * than one. The ordinals this list used to carry are gone deliberately —
   * they numbered the order spells left in, which no reader can check and
   * every batch renumbered.
   *
   * Three went the same way. `ActionRule` was derived from four SRD sentences
   * and no definition wrote one; these three write all four — Wind Walk's "The
   * only actions a target can take in this form", Magic Jar's "You can't move
   * or take Reactions" beside "The only action you can take", and Expeditious
   * Retreat's "you can take that action again as a Bonus Action", which is the
   * `allows` polarity and the last of the four. So the engine resolves
   * something on each casting, which is the whole of what separates the two
   * buckets, and everything else each spell prints is an executed definition's
   * debt in `ADJUDICATED`.
   *
   * **Aid is the fourth.** Its whole text is twenty-two words about a hit
   * point maximum, so a pass that could not move one had nothing to write and
   * tracked it; the `hit-point-maximum` effect is that writer, and the spell is
   * now executed end to end with no sentence left over — which is why it is
   * also the first of these to leave `ADJUDICATED` entirely rather than move a
   * clause into it.
   *
   * **Goodberry is the fifth**, and its effect list is still empty and always
   * will be: what the spell does is put ten berries in a hand, which is
   * `conjures`, and eating one is the berry's own conferral.
   *
   * **Enhance Ability is the sixth.** Its six named blessings are one effect
   * with the ability named at the casting rather than six definitions, so
   * `choiceStated` is what it was waiting for.
   *
   * **Faerie Fire is the seventh**, and it is the first to leave by a door in
   * the *format*: its failed save imposes no condition, so while
   * `save.condition` was required the spell had no host for the one thing it
   * does — take the benefit of the Invisible condition away. The field is
   * optional now, the Dexterity save hangs the `benefit` rider, and the
   * 20-foot Cube is an ordinary area picking its own targets.
   *
   * **Plant Growth and Spike Growth are the eighth and ninth, and they
   * leave by a fifth door.** Neither rolls anything and neither catches
   * anybody: what each does is make the ground expensive, which is a patch on
   * the lattice the casting keeps and the ruler charges for at every space a
   * move crosses. `isExecuted` reads `areaTerrain` for exactly that reason —
   * a spell whose only printed mechanic the engine now resolves is not one
   * the engine resolves nothing of.
   *
   * **Darkness, Daylight and Fog Cloud leave by the same door with a
   * different noun.** P3-S put light
   * and obscurement on the lattice beside the ground, so a Sphere of magical
   * darkness, sixty feet of sunlight with sixty more of dim around it, and a
   * bank of fog that grows with the slot are all patches a casting lays,
   * keeps alive and has read at every question about who can see whom.
   * `isExecuted` reads `areaLight` and `areaObscurement` for the reason it
   * reads `areaTerrain`, and all three are argued in `coverage-data.ts`.
   *
   * **Find Steed and Phantom Steed leave
   * by the door P2-T11 built.** Each is one sentence long — a creature with a
   * stat block appears — and what that sentence needed was two things at once:
   * a `summon` effect kind, so a casting derives its creature from the spell
   * rather than a caller reading the casting id back and summoning by hand;
   * and somewhere for a stat block the book prints *inside a spell entry* to
   * live, which the owner's ruling of 2026-09-21 settled as the bestiary. The
   * Phantom Steed is held here by its casting and goes when the hour is up;
   * the Otherworldly Steed is Instantaneous, is bound to nothing, and carries
   * the two numbers SRD prints over its own block as arithmetic on the slot.
   */
  /**
   * **Mirror Image and Sanctuary leave by a door the owner opened on
   * 2026-09-22**, and the reading that kept them here for three attempts was
   * one word. Both were filed as firing on *targeting* — a moment the casting
   * owns, with nobody electing anything — and SRD Mirror Image does not: "Each
   * time a creature **hits** you with an attack roll", which is the instant the
   * engine already stops at between the roll and the damage. Sanctuary does
   * fire on targeting, and for a weapon swing that moment is inside the attack
   * command too, before the Attack action is spent.
   *
   * What both needed was the shape rather than the moment: a **passive
   * defence**, an ongoing effect on the defender that the attack path consults
   * with nobody taking a Reaction. Mirror Image also needed the one thing no
   * casting had ever hung on a creature — a count that goes down — and
   * Sanctuary needed a ruling about what a failed ward costs, which the owner
   * gave: the attack is lost, nothing is spent, and one save per ward per
   * turn.
   */
  /**
   * **Augury leaves by a door built out of the item vocabulary**, which is
   * what makes it worth a paragraph of its own: nothing here was invented.
   * SRD Wind Fan prints "a cumulative 20 percent chance of not working" and
   * the item grant has said so since charges landed — a `Tally` counting the
   * uses, `cumulativeChance` multiplying them, a d100 thrown against the
   * result and not thrown at all when the result is zero. Augury prints the
   * same sentence with a rest in place of a dawn and an unanswered question in
   * place of a torn fan, so the `chance` effect is that machinery pointed at a
   * casting, sharing the die and the line it writes in the log.
   *
   * What it decides is the one thing a casting can decide about a handover:
   * SRD's "you get **no answer**" means the printed text this definition hands
   * the table does not go out for that casting. The omen stays the GM's — it
   * was never a debt — and the percentage stops being one.
   */
  const EXECUTED_SINCE: readonly string[] = [
    'aid',
    // **Arcanist's Magic Aura leaves by the one spell in the book that lies to
    // another spell.** A creature's type is a fact the engine holds
    // authoritatively and refuses to contradict, so the Mask does not write
    // it: `creature-type-override` is the nineteenth sourced grant, hung under
    // the casting, and `typeMagicSees` is where the sentence's own line —
    // *spells and other magical effects* — is drawn between the readers that
    // believe it and the creature reading a creature that does not. The False
    // Aura and the thirty days are the two sentences left, and both are about
    // an object.
    'arcanists-magic-aura',
    'augury',
    // **Barkskin leaves by the second arm of `armor-class`.** The spell is one
    // sentence and the whole of it was the arm that did not exist: a base
    // calculation competes to *be* the Armour Class and a floor refuses the
    // finished total if it came out under seventeen, which is read last and
    // through plate. Nothing is left but willingness and the bark.
    'barkskin',
    'darkness',
    'daylight',
    'enhance-ability',
    'expeditious-retreat',
    'faerie-fire',
    // Feather Fall left the tracked bucket too, on the half the `falling`
    // shape was still owed — a ward the landing reads, hung per creature so
    // that one of five landing ends the spell on that one and leaves the other
    // four in the air. It is **not** in this list, because this list is about
    // the spells `ADDED` names and Feather Fall was written before that pass;
    // `blocked-on.test.ts` is where its departure is recorded.
    'find-steed',
    // **Flaming Sphere leaves on a reach rather than on a template.** Its
    // clause is "within 5 feet of the sphere", measured from a point the
    // casting holds — `areaTrigger.within` — while the volume it fills is the
    // light it sheds, which is Dancing Lights' reading of what an area is. The
    // ram is a second sentence and gets a second field: `onPointEntry` catches
    // only the creature whose space the sphere is rolled into, where Moonbeam's
    // `onAreaEntry` catches everyone the area sweeps over.
    'flaming-sphere',
    'fog-cloud',
    'goodberry',
    // **Heat Metal leaves by the verb that takes a thing out of a hand.**
    // `what-a-creature-is-holding` was half built — hands counted, a casting
    // able to put a thing into one — and `OutcomeRiders.drops` is the other
    // half: the failed Constitution save lets go of the object, "if it can" is
    // `handsFor`, and the Disadvantage is the `orElse` that runs only where it
    // could not be. The object is an equipped item, the Bonus Action deals the
    // same damage again through the record, and what is left is an object
    // nobody is wearing or wielding.
    'heat-metal',
    // **Ice Knife leaves by a second parent rather than a sixth rider.** "Hit
    // or miss, the shard then explodes" hangs off neither branch of the
    // attack, so `attack.then` is a second resolution sequenced after the
    // first: its own Sphere, centred on the space the shard reached, its own
    // effect list, and one level deep. Nothing of the spell is left.
    'ice-knife',
    'magic-jar',
    'mirror-image',
    'phantom-steed',
    'plant-growth',
    // **Ray of Enfeeblement leaves on three shapes at once**, which is what
    // kept it tracked: a selector for a family of D20 Tests narrowed by an
    // ability, a penalty on the target's **own** damage rolls — the mirror
    // of the reduction Resistance below hangs on a defender — and a success
    // branch that does something, which is the rarest shape in the book. The
    // repeat had no condition to be filed on either, so it rides on the
    // casting's deadline the way Searing Smite's does.
    'ray-of-enfeeblement',
    // **Resistance leaves with nothing left over**, which is Aid's door rather
    // than the nine others: the whole of the cantrip is a d4 off a hit of a
    // chosen type, and `damage-reduction` is the first thing the damage
    // pipeline ever consulted on the defender's own side that nobody had to
    // spend a Reaction to reach. The eleven printed types are a
    // `damageTypeStated` list and the once-per-turn limit is the engine's own
    // ledger, so the only sentence it hands the table is whether the creature
    // touched was willing.
    'resistance',
    // **Revivify leaves by the one thing healing is not allowed to do.**
    // `healCreature` refuses a corpse in its first line, and the refusal is
    // the rule rather than an obstacle: hit points do not lift death. So the
    // `revive` effect is its own kind and `creature-revived` its own event,
    // and the minute the spell reaches back is subtraction over
    // `Vitals.diedAt` — a stamp the fold derives from the fact itself, because
    // a creature dies four ways and only one of them says so in an event. Old
    // age and the body parts are the two sentences left, and neither is a fact
    // the engine holds.
    'revivify',
    'sanctuary',
    // **Sleep leaves by the repeat save's new failure branch.** The save and
    // the Incapacitated were always ordinary; what had nowhere to go was "at
    // which point it must repeat the save. If the target fails the second
    // save, the target has the Unconscious condition" — a repeat whose
    // *failure* acts and then stops asking, which `SpellRepeatSave.onFailure`
    // is. Three clauses of five left its `unmodelled`; the area's filter, the
    // shake-awake and the automatic successes stay, in `ADJUDICATED` now.
    'sleep',
    // **Sleet Storm leaves by the last three words of its save.** The
    // Cylinder, both trigger moments, the Difficult Terrain and the Heavily
    // Obscured air are Web's clauses and were all writable; "and lose
    // Concentration" is the one that had no slot, and
    // `OutcomeRiders.breaksConcentration` is it. Only the doused flames are
    // left, which are a fact about a room.
    'sleet-storm',
    'spike-growth',
    // **True Strike leaves by a door no effect kind opened.** Its swing *is*
    // the casting — "you make one attack with the weapon used in the spell's
    // casting" — so `weapon-attack` is resolved by the attack command, which
    // takes the cantrip beside the weapon, substitutes the spellcasting
    // ability into both rolls and adds the Cantrip Upgrade's Radiant die.
    // Nothing is granted and nothing outlives the swing, which is why this is
    // the one entry here that the casting sweeps below cannot drive.
    'true-strike',
    'wind-walk',
    // **Wind Wall leaves on the seventh template**, and it is the only one in
    // the book the caster draws: a path of 5-foot spaces along the ground,
    // judged at the cast against the fifty feet, the continuity, the single
    // ground and the Range to the space it rises from. The Strength save and
    // the 4d8 are the most ordinary shape there is, once there is somewhere to
    // resolve them. What the spell still owes is the **barrier** — an arrow
    // deflected upward, a Small flier turned back — so it leaves the tracked
    // bucket as executed-partial rather than clean, and
    // `a-barrier-that-blocks-passage` keeps it.
    'wind-wall',
    // The last of the tracked spells to be blocked on a *publication* rather
    // than on a mechanic. The Charisma save was always ordinary and both
    // moments it fires at were `AreaTrigger` members; what it had nowhere to
    // put was the answer, because the failure imposes nothing this engine
    // holds. `save.recordsOutcome` writes the verdict onto the casting and
    // `look` reports it, which is the door gate G1's ruling required.
    'zone-of-truth',
  ];

  it('records the departures rather than deleting the rows', () => {
    expect(EXECUTED_SINCE).toEqual([...EXECUTED_SINCE].sort());
    expect(EXECUTED_SINCE.length).toBeGreaterThan(0);
    expect(EXECUTED_SINCE.filter((spellId) => !ADDED.includes(spellId))).toEqual([]);
  });

  /** Tracked, so every sweep above is already about every one of them. */
  it.each(ADDED.map((s) => [s] as const))('tracks %s', (spellId) => {
    const definition = SRD_CONTENT.spell(spellId);
    expect(definition, `${spellId} has no definition`).not.toBeNull();
    if (EXECUTED_SINCE.includes(spellId)) {
      expect(isExecuted(definition!), spellId).toBe(true);
      expect(TRACKED, spellId).not.toContain(spellId);
      return;
    }
    expect(definition?.effects, spellId).toEqual([]);
    expect(TRACKED, spellId).toContain(spellId);
  });

  /**
   * And the spells this command cannot cast say so, rather than being quietly
   * left out of the sweeps that cast.
   */
  it('takes only the spells this command can cast into the sweeps that cast', () => {
    expect(ADDED.filter(castOnASwing)).toEqual(['true-strike']);
    expect(DRIVEN_HERE).toEqual(ADDED.filter((s) => s !== 'true-strike'));
  });

  it.each(ADDED.filter(castOnASwing).map((s) => [s] as const))(
    'refuses %s at the ordinary casting command, which makes no attack',
    (spellId) => {
      const out = cast(spellId);
      expect(isErr(out), spellId).toBe(true);
      if (isErr(out)) expect(out.code).toBe('cast_with_a_swing');
    },
  );

  /** A levelled casting spends exactly one slot of its own level. */
  it.each(DRIVEN_HERE.filter((s) => (SRD_CONTENT.spell(s)?.level ?? 0) > 0).map((s) => [s] as const))(
    'spends one slot for %s',
    (spellId) => {
      const level = SRD_CONTENT.spell(spellId)!.level;
      const out = driven(spellId);
      const after = fold('seed', [...logFor(spellId), ...out.events]);
      expect(remaining(after.creatures.wizard!.resources, spellSlotKey(level)), spellId).toBe(3);
    },
  );

  /** And the action the book prints, out of the turn that has one to spend. */
  it.each(DRIVEN_HERE.map((s) => [s] as const))('takes the action the book prints for %s', (spellId) => {
    const inCombat: readonly GameEvent[] = [
      ...SETUP,
      {
        type: 'combat-started',
        combatants: [
          { id: WIZARD, initiative: 20, speed: 30 },
          { id: ALLY, initiative: 10, speed: 30 },
          { id: FOE, initiative: 5, speed: 30 },
        ],
      },
    ];
    const out = resolved(spellId, {}, inCombat);
    const budget = fold('seed', [...inCombat, ...out.events]).combat?.budgets.wizard;
    if (SRD_CONTENT.spell(spellId)!.castingTime === 'bonus-action') {
      expect(budget?.bonusAction, spellId).toBe(false);
      expect(budget?.action, spellId).toBe(true);
    } else {
      expect(budget?.action, spellId).toBe(false);
    }
  });

  /** Concentration exactly where the printed Duration says so, and nowhere else. */
  it.each(DRIVEN_HERE.map((s) => [s] as const))('concentrates on %s only if the book does', (spellId) => {
    const out = driven(spellId);
    const after = fold('seed', [...logFor(spellId), ...out.events]);
    expect(after.creatures.wizard!.concentration !== null, spellId).toBe(
      SRD_CONTENT.spell(spellId)!.concentration,
    );
  });

  /**
   * A span the book prints runs out on the clock, and a spell with no span
   * schedules nothing. Driven a second short of the deadline as well as past
   * it, because a timer that expired early would still leave zero behind.
   */
  it.each(DRIVEN_HERE.map((s) => [s] as const))('runs %s’s duration on the clock', (spellId) => {
    const seconds = SRD_CONTENT.spell(spellId)!.durationSeconds;
    const log = [...logFor(spellId), ...driven(spellId).events];
    // **The casting’s own deadline, counted apart from anything else it
    // hung.** This asked for one timer in total, which was the same number
    // while nothing tracked here hung a rider with a deadline of its own; SRD
    // Ray of Enfeeblement hangs one on the branch a success takes, and a
    // `grants` timer standing beside the casting’s is the rider working
    // rather than the span being wrong. So the claim is made precise rather
    // than loosened: the casting has exactly one deadline, and the clock ends
    // it.
    const castings = (state: GameState) =>
      Object.values(state.timers).filter((timer) => timer.target.kind === 'casting');
    if (seconds === undefined) {
      expect(castings(fold('seed', log)), spellId).toHaveLength(0);
      return;
    }
    expect(castings(fold('seed', log)), spellId).toHaveLength(1);
    const almost = fold('seed', [
      ...log,
      { type: 'time-advanced', seconds: seconds - 1, reason: 'the party waits' },
    ]);
    expect(castings(almost), spellId).toHaveLength(1);
    const expired = fold('seed', [
      ...log,
      { type: 'time-advanced', seconds, reason: 'the party waits' },
    ]);
    expect(castings(expired), spellId).toHaveLength(0);
  });

  /**
   * A count the book prints, driven rather than read back.
   *
   * **The oracle has no column for a target count**, so a definition saying
   * one where the SRD says three would agree with every automatic check there
   * is — a review turned Aid's three into one and nothing went red. What the
   * catalogue can prove is the refusal: three are accepted and a fourth is
   * not, which no wrong number sits between.
   */
  it('takes the three creatures Aid names, and refuses a fourth', () => {
    expect(unwrap(cast('aid', { targets: [ALLY, FOE, BEAST] }), 'aid at three').castingId!.length)
      .toBeGreaterThan(0);
    const four = cast('aid', { targets: [ALLY, FOE, BEAST, WIZARD] });
    expect(isErr(four)).toBe(true);
    if (isErr(four)) expect(four.code).toBe('too_many_targets');
  });

  /**
   * And the caster is one of the three, which is a separate claim.
   *
   * SRD's *Targeting Yourself*: "If a spell targets a creature of your
   * choice, you can choose yourself unless the creature must be hostile or
   * specifically a creature other than you." Aid says "Choose up to three
   * creatures within range" and prints no such exclusion, so a caster
   * standing inside their own thirty feet is eligible. **The count check runs
   * first**, so the refusal above passes either way and says nothing about
   * this: the discriminating case is a legal three that includes the caster,
   * which is refused outright without the flag.
   */
  it('lets Aid reach the caster, whom the SRD does not exclude', () => {
    const out = unwrap(cast('aid', { targets: [WIZARD, ALLY, FOE] }), 'aid on the caster');
    expect(out.events.filter((e) => e.type === 'spell-cast')).toHaveLength(1);
    // And the spell that does exclude its caster still does, so the flag is a
    // reading of Aid rather than a hole in the rule.
    const shared = cast('plane-shift', { targets: [WIZARD] });
    expect(isErr(shared)).toBe(true);
    if (isErr(shared)) expect(shared.code).toBe('cannot_target_self');
  });

  /**
   * SRD Sanctuary: "The spell ends if the warded creature makes an attack
   * roll, casts a spell, or deals damage."
   *
   * Invisibility's three causes on a casting with no effects under it, and
   * the half of this spell the engine really does. Asserted by **driving**
   * one of the three, because an equality check on the `endsEarly` list is
   * the definition agreeing with itself: the ward goes up, the warded
   * creature hurts somebody, and the casting is gone.
   */
  it('ends Sanctuary when the warded creature deals damage', () => {
    const warded = [...SETUP, ...resolved('sanctuary', { targets: [ALLY] }).events];
    expect(Object.keys(fold('seed', warded).ongoing)).toHaveLength(1);

    const struck = unwrap(
      resolveDamage(fold('seed', warded), FOE, { amount: 4, source: 'a mace', by: ALLY }, supply()),
      'the ward is broken',
    );
    const after = fold('seed', [...warded, ...struck.events]);
    expect(Object.keys(after.ongoing)).toHaveLength(0);
  });

  /**
   * And every one of them tells the table what it is being left, verbatim.
   *
   * **Except the ones now left with nothing**, which is the honest end of a
   * row rather than a hole in the sweep: every sentence they print is
   * executed, so there is no `unmodelled` to hand over and this assertion
   * would demand one exist. `EXECUTED_SINCE` is where that is recorded and
   * why, and the assertion below is the positive form of it. Aid was the
   * first; Expeditious Retreat is the second, once `ActionRule` grew the
   * member that hands a turn an extra action and its nineteen words became
   * two effects.
   */
  const FINISHED_OUTRIGHT: readonly string[] = [
    'aid',
    'expeditious-retreat',
    // The third, and the three shapes it was waiting on all arrived together:
    // a family of D20 Tests picked out by an ability, a penalty on the
    // target’s own damage rolls, and a success branch that does something.
    'ray-of-enfeeblement',
  ];

  /**
   * The third end of a row, and it is a different claim from either of the
   * other two.
   *
   * Augury owes the table nothing — every mechanical sentence it prints is
   * executed — and still hands text over on every casting, because the omen
   * was never a debt: "The GM chooses the omen from the Omens table" is a
   * question nobody here will ever answer. `FINISHED_OUTRIGHT` asserts an
   * *empty* `unverified` and would call that a defect; what is actually owed
   * is that nothing under the debt form is in there, and that what is under
   * the handover mark is exactly what the definition prints.
   */
  const FINISHED_BUT_HANDS_OVER: readonly string[] = ['augury'];

  it.each(FINISHED_BUT_HANDS_OVER.map((s) => [s] as const))(
    'leaves the table no debt of %s and still hands over its text',
    (spellId) => {
      const definition = SRD_CONTENT.spell(spellId)!;
      const out = driven(spellId);
      expect(definition.unmodelled ?? [], spellId).toEqual([]);
      // A rite reports its handover twice — once at the declaration and once
      // at the settlement — and `driven` concatenates both, which is what the
      // set is for.
      expect([...new Set(dmDecisionsIn(out.unverified))], spellId).toEqual([
        ...(definition.dmDecides ?? []),
      ]);
      // And nothing in there is a debt: a gap travels under no mark at all,
      // so every line that is not a handover would be one.
      expect(new Set(out.unverified).size, spellId).toBe((definition.dmDecides ?? []).length);
    },
  );

  /**
   * A fourth end of a row, and the difference is whose sentence is left.
   *
   * Ice Knife owes the table nothing: every sentence it prints is a roll, and
   * the one that had nowhere to go — "Hit or miss, the shard then explodes" —
   * is `attack.then`, a second resolution rather than a rider on a branch the
   * sentence explicitly does not take. What it still reports is a fact about
   * the **fixture** — nobody in this file has a side, so an attack cannot tell
   * whether anybody standing beside the caster is an enemy — and that is a
   * thin scene rather than a debt of the spell. So the claim made here is the
   * precise one: nothing under the definition's own mark.
   */
  const FINISHED_BUT_THE_SCENE_IS_THIN: readonly string[] = ['ice-knife'];

  it.each(FINISHED_BUT_THE_SCENE_IS_THIN.map((s) => [s] as const))(
    'leaves the table no debt of %s, whatever the scene cannot say',
    (spellId) => {
      const definition = SRD_CONTENT.spell(spellId)!;
      expect(definition.unmodelled ?? []).toEqual([]);
      expect(definition.dmDecides ?? []).toEqual([]);
      const out = driven(spellId);
      expect(out.unverified.filter((line) => line.startsWith(`${definition.name}:`))).toEqual([]);
      expect(dmDecisionsIn(out.unverified)).toEqual([]);
    },
  );

  it.each(
    DRIVEN_HERE.filter(
      (s) =>
        !FINISHED_OUTRIGHT.includes(s) &&
        !FINISHED_BUT_HANDS_OVER.includes(s) &&
        !FINISHED_BUT_THE_SCENE_IS_THIN.includes(s),
    ).map((s) => [s] as const),
  )(
    'hands %s’s own sentences to the table',
    (spellId) => {
      const definition = SRD_CONTENT.spell(spellId)!;
      const out = driven(spellId);
      expect(definition.unmodelled ?? [], spellId).not.toEqual([]);
      for (const gap of definition.unmodelled ?? []) {
        expect(out.unverified).toContain(`${definition.name}: ${gap}`);
      }
    },
  );

  /** And the two left with nothing to hand over, which is what finished means. */
  it.each(FINISHED_OUTRIGHT.map((s) => [s] as const))('leaves the table nothing of %s', (spellId) => {
    expect(SRD_CONTENT.spell(spellId)!.unmodelled ?? []).toEqual([]);
    expect(driven(spellId).unverified).toEqual([]);
  });

  /**
   * SRD Calm Emotions: "Duration: Concentration, up to 1 minute."
   *
   * The sweeps above say the Concentration is taken and the minute runs; this
   * says it is the **same** Concentration every other casting competes for, by
   * driving the one thing an equality check on a flag cannot — a spell already
   * being held is let go when this one starts.
   */
  it('gives up a held Concentration to start Calm Emotions', () => {
    const held = [...SETUP, ...resolved('fly').events];
    const out = resolved('calm-emotions', {}, held);
    expect(out.events.some((e) => e.type === 'concentration-ended')).toBe(true);
    const after = fold('seed', [...held, ...out.events]);
    expect(after.creatures.wizard!.concentration?.castingId).toBe(out.castingId);
  });

  /**
   * SRD Hallow: "Casting Time: 24 hours", and "Duration: Until dispelled."
   *
   * The longest casting in the book, driven rather than read off the
   * definition: the declaration stands open for the whole day, a casting
   * settled before the day is out is refused, and what the day buys never runs
   * out on its own.
   */
  it('holds Hallow open for a day and then never expires', () => {
    const declaration = resolved('hallow');
    expect(declaration.events.some((e) => e.type === 'spell-declared')).toBe(true);
    expect(declaration.events.some((e) => e.type === 'spell-cast')).toBe(false);

    const open = fold('seed', [...SETUP, ...declaration.events]);
    const castingId = pendingCastingsOf(open)[0]!.castingId;
    expect(isErr(resolveDeclaredCast(open, castingId, supply()))).toBe(true);

    const tick = unwrap(advanceTime(open, 86_400, 'the rite'), 'a day passes');
    const ticked = [...SETUP, ...declaration.events, ...tick];
    const settled = unwrap(
      resolveDeclaredCast(fold('seed', ticked), castingId, supply()),
      'the rite finishes',
    );
    expect(settled.events.filter((e) => e.type === 'spell-cast')).toHaveLength(1);
    const after = fold('seed', [...ticked, ...settled.events]);
    expect(Object.keys(after.timers)).toHaveLength(0);
  });
});
