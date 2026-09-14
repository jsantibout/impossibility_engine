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
import {
  MECHANICAL_MARKERS,
  MISSING_SHAPES,
  TRACKED_ADJUDICATED as ADJUDICATED,
  type MarkerId,
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
const TRACKED: readonly string[] = SPELL_DEFINITIONS.filter(
  // A spell whose *activation* the engine resolves is executed, not tracked:
  // Flame Blade's casting evokes a blade and does nothing else, and every blow
  // it strikes comes through machinery the engine owns.
  (d) => d.effects.length === 0 && d.activation === undefined && d.areaTrigger === undefined,
)
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
 * The markers, the vocabulary and the adjudications, all moved out.
 *
 * They live in `scripts/missing-shapes.ts` with the executed and undefined
 * populations' maps, because a shape all three name — `speed-and-movement-modes`
 * is the one — counted three spells short while this map was private. Every
 * guard over the tracked bucket is still here; the one that could not stay,
 * "no shape sits unclaimed", is in `blocked-on.test.ts`, because asked of this
 * map alone it would delete every shape only the other two populations name.
 *
 * The two ids this bucket used to own privately, `jumping` and
 * `teleportation`, are in the shared vocabulary now and each still says where
 * this repository already described the gap.
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

  /**
   * "No shape sits unclaimed" is in `blocked-on.test.ts` now, over all three
   * populations at once. Asked of this map alone it would delete every shape
   * only an executed or an undefined spell names, which is all but three.
   * What stays is the half about *this* map: a shape it names is one the
   * vocabulary has.
   */
  it('names no shape the vocabulary does not have', () => {
    const known = new Set<string>(Object.keys(MISSING_SHAPES));
    for (const [spellId, written] of Object.entries(ADJUDICATED)) {
      for (const [marker, entry] of Object.entries(written)) {
        if (entry.why === 'table' || entry.why === 'engine') continue;
        expect(known.has(entry.why), `${spellId}/${marker}`).toBe(true);
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
