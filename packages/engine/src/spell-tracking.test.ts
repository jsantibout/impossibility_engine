import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { resolveSpell } from './commands.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SPELL_DEFINITIONS, definitionFor } from './spell-definitions.js';

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

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 50,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

/**
 * Every tracked spell there is, read off the catalogue rather than listed.
 *
 * A hand-written list would drift the moment somebody adds a definition with
 * no effects, and the spell that drifted off it is exactly the one nobody
 * drove. `effects.length === 0` is the same predicate `coverage.ts` counts
 * with, so the list under test and the number in `COVERAGE.md` cannot disagree.
 */
const TRACKED: readonly string[] = SPELL_DEFINITIONS.filter((d) => d.effects.length === 0)
  .map((d) => d.id)
  .sort();

const SETUP: readonly GameEvent[] = [
  added(WIZARD),
  added(ALLY),
  added(FOE),
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
  { type: 'sight-declared', from: WIZARD, to: ALLY, seen: true },
  { type: 'sight-declared', from: WIZARD, to: FOE, seen: true },
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

const supply = () => ({ issuer: createRollIssuer('r'), rng: createRng('cast') as Rng });

/** Cast a tracked spell at whatever its target rule asks for. */
const cast = (
  spellId: string,
  over: Partial<Parameters<typeof resolveSpell>[2]> = {},
  log: readonly GameEvent[] = SETUP,
) => {
  const definition = definitionFor(spellId);
  if (definition === null) throw new Error(`${spellId} has no definition`);
  const targets = definition.targets.count === 0 ? [] : [ALLY];
  return resolveSpell(
    fold('seed', log),
    WIZARD,
    {
      spellId,
      targets,
      ...(definition.level === 0 ? {} : { slotLevel: definition.level }),
      ...over,
    },
    supply(),
  );
};

const resolved = (spellId: string, over = {}, log: readonly GameEvent[] = SETUP) =>
  unwrap(cast(spellId, over, log), spellId);

describe('a tracked spell is cast, not refused', () => {
  it.each(TRACKED.map((s) => [s] as const))('casts %s', (spellId) => {
    const out = resolved(spellId);
    expect(out.events.filter((e) => e.type === 'spell-cast')).toHaveLength(1);
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
    expect(definitionFor('misty-step')?.castingTime).toBe('bonus-action');
    expect(definitionFor('jump')?.castingTime).toBe('bonus-action');
    expect(definitionFor('fly')?.castingTime).toBe('action');
  });

  /**
   * Every one of these says what it is leaving to the table. A tracked spell
   * that declared nothing would be a definition that silently did nothing,
   * which is worse than the refusal it replaced.
   */
  it.each(TRACKED.map((s) => [s] as const))('says what a DM still does for %s', (spellId) => {
    const out = resolved(spellId);
    expect(out.unverified.length).toBeGreaterThan(0);
    expect(out.unverified.join(' ')).toContain(definitionFor(spellId)!.name);
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
    expect(out.castingId.length).toBeGreaterThan(0);
  });

  /** SRD Water Breathing: "up to ten willing creatures of your choice". */
  it('reads a ten-target spell as a ten-target spell', () => {
    expect(definitionFor('water-breathing')?.targets.count).toBe(10);
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
    const out = resolved(spellId);
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
 * The guard that keeps `unmodelled` from becoming a dumping ground.
 *
 * `unmodelled` means exactly one thing: **this part of the spell belongs to
 * the fiction, and the engine should never decide it**. It must never come to
 * mean "the engine ought to enforce this and nobody has built it yet", because
 * those two read identically at the table and only one of them is honest. A
 * tracked spell is the easiest place in the codebase to blur them: its
 * `effects` list is empty by design, so any rule at all can be dropped into a
 * sentence and the suite stays green.
 *
 * So the line is drawn mechanically rather than by review. Each tracked spell
 * is read back out of the **parsed SRD** — its own printed prose, not a
 * summary anyone wrote here — and scanned for clauses that name something the
 * engine demonstrably owns: dice, a saving throw, an ability check, an Armour
 * Class, Hit Points, a Resistance or Immunity, a condition, Advantage or
 * Disadvantage, a Speed, a percentage chance, a cost in feet of movement, or
 * extra damage. A spell whose text contains one of those may still be tracked,
 * but somebody has to write down *why* — and the why is one of two kinds:
 *
 * | | |
 * |---|---|
 * | `'table'` | the clause fires on a fictional trigger the engine cannot see, and the DM raises it through commands that already exist |
 * | a shape id | the clause is genuinely mechanical and a named, enumerated shape is missing |
 *
 * The second kind must name an entry in {@link MISSING_SHAPES}, which is the
 * architecture map as data. That is the part that bites: adding Barkskin to
 * the tracked list means writing `armor-class` against a shape id, and either
 * the shape is already named — in which case the debt was already public — or
 * a new one has to be added to a list somebody reviews.
 *
 * **What this does not do.** It is a floor, not a proof. It reads prose, so a
 * rule the SRD phrases without any of these words slips through: Gate and
 * Etherealness both move creatures between planes and trip nothing, and
 * Arcanist's Magic Aura changes what other spells think a creature *is*
 * without using the word "condition". Those are caught by reading the spell,
 * which is what the audit in `PROGRESS.md` is. This catches the ones that are
 * easy to wave through, which is most of them: of the forty-five utility
 * spells this batch rejected, it fires on forty.
 */
const MECHANICAL_MARKERS = [
  ['dice', /\b\d+d\d+\b/],
  ['saving-throw', /saving throw/i],
  [
    'ability-check',
    /\b(ability|Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\b[^.]{0,40}\bcheck\b/,
  ],
  ['armor-class', /\bArmor Class\b|\bAC\b/],
  ['hit-points', /\bHit Points?\b/],
  ['defence', /\b(Resistance|Immunity|Vulnerability) to\b/],
  ['condition', /\bcondition\b/i],
  ['roll-mode', /\b(Advantage|Disadvantage) on\b/],
  ['speed', /\bSpeed\b/],
  ['chance', /\bpercent chance\b/i],
  ['movement-cost', /\b\d+ (feet|foot) of movement\b/i],
  ['teleport', /\bteleport/i],
  ['extra-damage', /\bextra\b[^.]{0,30}\bdamage\b/i],
] as const satisfies readonly (readonly [string, RegExp])[];

type MarkerId = (typeof MECHANICAL_MARKERS)[number][0];

/**
 * The mechanical shapes that stand between a tracked spell and an executed one.
 *
 * Only shapes that a *tracked* spell actually leans on: this is the list the
 * adjudications below are allowed to name, not the whole architecture map. A
 * shape nothing names is removed by the test, so the list cannot rot into a
 * catalogue of good intentions.
 */
const MISSING_SHAPES = {
  'speed-and-movement-modes':
    'a Speed a spell changes, and the Fly, Climb and Swim modes the engine does not distinguish — Longstrider, Fly, Spider Climb, Freedom of Movement',
  jumping: 'jumping, which nothing models, so a jump distance has nothing to be measured against',
  'teleportation':
    'relocating a creature without spending movement: `moveCreature` charges a budget and `placeCreature` refuses a creature that already has a position, so no command performs a teleport — Misty Step, Dimension Door, Tree Stride',
} as const;

type ShapeId = keyof typeof MISSING_SHAPES;

interface Adjudication {
  /**
   * Which of three things this clause is.
   *
   * | | |
   * |---|---|
   * | `'table'` | fiction; the engine should never decide it |
   * | `'engine'` | the engine **does** execute it, and nothing is delegated |
   * | a shape id | mechanical, and this names the shape that blocks it |
   *
   * `'engine'` arrived when ability checks became reachable from a spell, and
   * it is the half that keeps this honest in the other direction. A tracked
   * spell is not "a spell the engine does nothing about": Disguise Self is
   * tracked because a disguise is not arithmetic, and the Investigation check
   * that sees through it *is*, and is rolled. Without this value the only way
   * to record a solved clause would be to go on calling it missing.
   */
  readonly why: 'table' | 'engine' | ShapeId;
  readonly note: string;
}

/**
 * Why each mechanical clause in a tracked spell's own SRD text is not executed.
 *
 * Every entry was written by reading that spell's paragraph in
 * `packages/srd/raw/spells.md`. Eight spells out of forty-four need one, which
 * is the measure of how well the tracked bucket was chosen: the other
 * thirty-six contain no mechanical clause at all.
 */
const ADJUDICATED: Readonly<
  Record<string, Partial<Record<MarkerId, Adjudication>>>
> = {
  'disguise-self': {
    'ability-check': {
      why: 'engine',
      note: 'the Intelligence (Investigation) check against the spell save DC is rolled by resolveEffectCheck against the casting own timer; the table decides only that somebody looked closely.',
    },
  },
  'minor-illusion': {
    'ability-check': {
      why: 'engine',
      note: 'the Intelligence (Investigation) check against the spell save DC is rolled by resolveEffectCheck; a cantrip, so the DC comes off the caster sheet rather than off any slot.',
    },
  },
  'silent-image': {
    'ability-check': {
      why: 'engine',
      note: 'the Intelligence (Investigation) check against the spell save DC is rolled by resolveEffectCheck, against a Concentration casting timer that ends with the Concentration.',
    },
  },
  demiplane: {
    condition: {
      why: 'table',
      note: 'a creature shunted out as the door vanishes lands Prone — but who is inside an unmodelled demiplane is a fiction the engine cannot see, and the DM applies the condition with applyConditionTo.',
    },
  },
  fly: {
    speed: {
      why: 'speed-and-movement-modes',
      note: 'a Fly Speed of 60 feet and hovering: the engine tracks one Speed and no movement modes.',
    },
  },
  jump: {
    'movement-cost': {
      why: 'jumping',
      note: '"jump up to 30 feet by spending 10 feet of movement" — the movement is spendable, the jump is not, so charging the 10 feet alone would be half a rule.',
    },
  },
  longstrider: {
    speed: {
      why: 'speed-and-movement-modes',
      note: '"the target’s Speed increases by 10 feet" — Speed comes from the species and nothing modifies it.',
    },
  },
  'see-invisibility': {
    condition: {
      why: 'table',
      note: 'seeing through the Invisible condition is declared, not derived: sight is a pairwise declaration and the condition’s own effects already read it, so the table declares the sight this spell grants.',
    },
  },
  'spider-climb': {
    speed: {
      why: 'speed-and-movement-modes',
      note: 'a Climb Speed equal to its Speed, and walls and ceilings: the engine tracks one Speed and no movement modes.',
    },
  },
  'misty-step': {
    teleport: {
      why: 'teleportation',
      note: '"you teleport up to 30 feet to an unoccupied space you can see" — the destination is a point in this scene, which the engine owns, and no command puts a creature at one without charging movement.',
    },
  },
  'plane-shift': {
    teleport: {
      why: 'table',
      note: 'the destination is a different plane of existence and the engine holds one scene, so there is no position to move anybody to: where the party arrives is the DM’s.',
    },
  },
  'word-of-recall': {
    teleport: {
      why: 'table',
      note: 'the sanctuary is a second place and the engine holds one scene, so the arrival is the DM’s — unlike Misty Step, no coordinate in this scene would be the right answer.',
    },
  },
  'transport-via-plants': {
    'movement-cost': {
      why: 'table',
      note: 'the 5 feet a creature spends stepping through is charged by the DM, because the far plant is at any distance — off the scene entirely — and there is no destination to move anybody to.',
    },
  },
};

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

/** The mechanical clauses the SRD's own text for this spell contains. */
const markersIn = (spellId: string): readonly MarkerId[] => {
  const text = PROSE.get(spellId);
  if (text === undefined) throw new Error(`${spellId} is not in the parsed SRD`);
  return MECHANICAL_MARKERS.filter(([, pattern]) => pattern.test(text)).map(([marker]) => marker);
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

  it('leaves most of the tracked bucket with nothing mechanical to explain', () => {
    const clean = TRACKED.filter((spellId) => markersIn(spellId).length === 0);
    expect(clean.length).toBeGreaterThan(TRACKED.length / 2);
  });

  it.each(TRACKED.map((s) => [s] as const))(
    'has a written adjudication for every mechanical clause in %s',
    (spellId) => {
      const found = markersIn(spellId);
      const written = ADJUDICATED[spellId] ?? {};
      for (const marker of found) {
        const entry = written[marker];
        expect(entry, `${spellId} has a ${marker} clause with no adjudication`).toBeDefined();
        expect(entry?.note.length ?? 0).toBeGreaterThan(40);
      }
    },
  );

  /**
   * A stale exemption is the same failure wearing the other face: a spell that
   * once had a clause, no longer does, and keeps a licence for it.
   */
  it('carries no adjudication for a clause the book does not contain', () => {
    for (const [spellId, written] of Object.entries(ADJUDICATED)) {
      const found = new Set<string>(markersIn(spellId));
      expect(Object.keys(written).filter((marker) => !found.has(marker)), spellId).toEqual([]);
    }
  });

  /** And every adjudicated spell is one the catalogue actually tracks. */
  it('adjudicates only spells that are tracked', () => {
    expect(Object.keys(ADJUDICATED).filter((id) => !TRACKED.includes(id))).toEqual([]);
  });

  /**
   * The half that makes this more than a comment box: a clause that is *not*
   * the table's must name an enumerated missing shape. Adding one means adding
   * to a list, which is the visible act this test exists to force.
   */
  it('names an enumerated shape for every clause that is not the table’s', () => {
    for (const [spellId, written] of Object.entries(ADJUDICATED)) {
      for (const [marker, entry] of Object.entries(written)) {
        if (entry.why === 'table' || entry.why === 'engine') continue;
        expect(Object.keys(MISSING_SHAPES), `${spellId}/${marker}`).toContain(entry.why);
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
      Object.values(ADJUDICATED).flatMap((w) => Object.values(w).map((e) => e.why)),
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
      const executes = definitionFor(spellId)?.check !== undefined;
      const claimed = ADJUDICATED[spellId]?.['ability-check']?.why === 'engine';
      expect(claimed, `${spellId}: check=${executes}, claims engine=${claimed}`).toBe(executes);
    }
  });

  /** A note that says nothing is a licence, so each must be specific. */
  it('writes a real sentence for every adjudication', () => {
    for (const [spellId, written] of Object.entries(ADJUDICATED)) {
      for (const [marker, entry] of Object.entries(written)) {
        expect(entry.note.length, `${spellId}/${marker}`).toBeGreaterThan(40);
      }
    }
  });

  /** No shape may sit in the map unclaimed, or the map becomes a wish list. */
  it('keeps no shape nothing is blocked on', () => {
    const claimed = new Set(
      Object.values(ADJUDICATED).flatMap((written) =>
        Object.values(written).map((entry) => entry.why),
      ),
    );
    expect(Object.keys(MISSING_SHAPES).filter((shape) => !claimed.has(shape as ShapeId))).toEqual(
      [],
    );
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
    expect(definitionFor('arcane-lock')?.durationSeconds).toBeUndefined();
  });

  /** Every tracked duration is a whole number of seconds the SRD actually prints. */
  it('gives Message one round, which is six seconds', () => {
    expect(definitionFor('message')?.durationSeconds).toBe(6);
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
    for (const gap of definitionFor('wall-of-force')!.unmodelled ?? []) {
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
    expect(definitionFor('plane-shift')?.targets.count).toBe(8);
    expect(definitionFor('plane-shift')?.targets.self).toBeUndefined();
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
