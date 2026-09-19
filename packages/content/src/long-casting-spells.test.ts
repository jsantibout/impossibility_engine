import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from '@ie/engine';
import { createRng, type Rng } from '@ie/engine';
import { createRollIssuer } from '@ie/engine';
import { fold, type GameEvent, type GameState } from '@ie/engine';
import { remaining, spellSlotKey } from '@ie/engine';
import { declaredCasting } from '@ie/engine';
import { type SpellDefinition } from '@ie/engine';
import {
  advanceTime,
  availableChecks,
  pendingCastingsBy,
  pendingCastingsOf,
  resolveDeclaredCast,
  resolveEffectCheck,
  resolveSpell,
} from '@ie/engine';

/**
 * The twelve spells a casting time of a minute or more was the whole of.
 *
 * IE-034 built the mechanism — a declared casting that completes on the clock,
 * and a Ritual as the same mechanism ten minutes longer — and recorded that no
 * catalogue definition reached it: every fixture in `long-casting.test.ts`
 * drives `resolveCast` directly or leans on the ten Rituals that print
 * "Action or Ritual" and so have no casting time of their own. These are the
 * definitions, read one at a time against their own SRD paragraphs, and this
 * is where the mechanism is driven through the **catalogue** rather than
 * through a hand-built request.
 *
 * All twelve are **tracked**: the engine spends the action, the slot, the
 * Concentration and the clock, and what each spell does — a ward that warns
 * you, a sensor a mile off, an object repaired, a page nobody else can read —
 * is the DM's and always will be. `spell-tracking.test.ts` holds that line
 * over the whole bucket; what is here is what a long casting adds.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const ALLY = id('ally');
const FOE = id('foe');

/** Every spell this task defines, and the seconds its printed casting takes. */
const TWELVE: readonly (readonly [string, number])[] = [
  // "Casting Time: 1 minute or Ritual"
  ['alarm', 60],
  // "Casting Time: 10 minutes"
  ['clairvoyance', 600],
  ['commune-with-nature', 60],
  ['fabricate', 600],
  ['find-the-path', 60],
  ['hallucinatory-terrain', 600],
  ['identify', 60],
  ['illusory-script', 60],
  ['instant-summons', 60],
  ['legend-lore', 600],
  ['magic-mouth', 60],
  ['mending', 60],
];

/** The six of them the book prints a Ritual tag for. */
const RITUALS: readonly string[] = [
  'alarm',
  'commune-with-nature',
  'identify',
  'illusory-script',
  'instant-summons',
  'magic-mouth',
];

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 12,
  abilities: { str: 10, dex: 12, con: 14, int: 18, wis: 10, cha: 10 },
  skills: { investigation: 'proficient' },
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
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const slotsFor = (who: CharacterId): readonly GameEvent[] =>
  [1, 2, 3, 4, 5, 6].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 4,
        recovers: 'long-rest',
      },
    }),
  );

const PREPARED = [...TWELVE.map(([spellId]) => spellId), 'detect-magic', 'bless'];

const SETUP: readonly GameEvent[] = [
  added(WIZARD),
  added(ALLY),
  added(FOE),
  ...slotsFor(WIZARD),
  ...slotsFor(ALLY),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { sceneCenter: true }, feet: 0 } },
  {
    type: 'creature-placed',
    id: ALLY,
    placement: { from: { creature: WIZARD }, feet: 5, bearing: 0 },
  },
  {
    type: 'creature-placed',
    id: FOE,
    placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 },
  },
  { type: 'sight-declared', from: WIZARD, to: ALLY, seen: true },
  { type: 'sight-declared', from: WIZARD, to: FOE, seen: true },
  ...[WIZARD, ALLY].map(
    (who): GameEvent => ({
      type: 'spellcasting-declared',
      id: who,
      spellcasting: declaredCasting({
        ability: 'int',
        classId: 'wizard',
        cantrips: ['mending'],
        prepared: PREPARED.filter((spellId) => spellId !== 'mending'),
      }),
    }),
  ),
];

const supply = (seed = 'cast') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const world = (extra: readonly GameEvent[] = []): GameState => fold('seed', [...SETUP, ...extra]);

const slots = (state: GameState, who: CharacterId, level: number) =>
  remaining(state.creatures[who]!.resources, spellSlotKey(level));

const defined = (spellId: string): SpellDefinition => {
  const definition = SRD_CONTENT.spell(spellId);
  if (definition === null) throw new Error(`${spellId} has no definition`);
  return definition;
};

/** Declare the casting the way a caller would: by id, at its own level. */
const declare = (
  spellId: string,
  over: Record<string, unknown> = {},
  log: readonly GameEvent[] = SETUP,
) => {
  const definition = defined(spellId);
  return resolveSpell(
    fold('seed', log),
    WIZARD,
    {
      spellId,
      targets: [],
      ...(definition.level === 0 ? {} : { slotLevel: definition.level }),
      ...over,
    },
    supply(),
  );
};

describe('the twelve are definitions, and every one of them is a long casting', () => {
  it.each(TWELVE)('defines %s with the span the book prints', (spellId, seconds) => {
    const definition = defined(spellId);
    expect(definition.castingTime).toBe('long');
    expect(definition.castingSeconds).toBe(seconds);
  });

  /**
   * Tracked, not executed — the engine spends the cost and the DM does the
   * spell. Asserted here as well as swept in `spell-tracking.test.ts` because
   * a definition of one of these that quietly grew an effect would be claiming
   * to resolve a ward, a sensor or a repaired wineskin.
   */
  it.each(TWELVE)('tracks %s rather than executing it', (spellId) => {
    const definition = defined(spellId);
    expect(definition.effects).toEqual([]);
    expect(definition.areaTrigger).toBeUndefined();
    expect(definition.activation).toBeUndefined();
    expect(definition.unmodelled ?? []).not.toEqual([]);
  });

  /** And the Ritual tag is on exactly the six the book tags. */
  it('carries the Ritual tag on the six the book prints one for', () => {
    expect(TWELVE.map(([spellId]) => spellId).filter((spellId) => defined(spellId).ritual === true))
      .toEqual([...RITUALS]);
  });
});

describe('a catalogue spell of a minute or more is declared, not cast', () => {
  /**
   * The whole point of the batch: `resolveSpell` given one of these returns a
   * **declaration**, spends no slot, and leaves a casting open until the clock
   * catches up. Before IE-034 every one of them was refused outright.
   */
  it.each(TWELVE)('declares %s and settles it when the clock arrives', (spellId, seconds) => {
    const definition = defined(spellId);
    const declared = unwrap(declare(spellId), spellId);
    expect(declared.events.some((e) => e.type === 'spell-declared')).toBe(true);
    expect(declared.events.some((e) => e.type === 'spell-cast')).toBe(false);

    const open = world(declared.events);
    const pending = pendingCastingsOf(open);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.completesAt).toEqual({ kind: 'elapsed', at: seconds });
    // SRD: "If your Concentration is broken, the spell fails, but you don't
    // expend a spell slot." Nothing is taken until the rite finishes.
    if (definition.level > 0) expect(slots(open, WIZARD, definition.level)).toBe(4);

    const tick = unwrap(advanceTime(open, seconds, 'the incantation'), 'tick');
    const log = [...SETUP, ...declared.events, ...tick];
    const settled = unwrap(
      resolveDeclaredCast(fold('seed', log), pending[0]!.castingId, supply()),
      `settle ${spellId}`,
    );
    expect(settled.events.filter((e) => e.type === 'spell-cast')).toHaveLength(1);

    const done = fold('seed', [...log, ...settled.events]);
    expect(pendingCastingsOf(done)).toEqual([]);
    if (definition.level > 0) expect(slots(done, WIZARD, definition.level)).toBe(3);
  });

  /** And settling a minute early is refused, so the span means something. */
  it.each(TWELVE)('refuses to settle %s a second early', (spellId, seconds) => {
    const declared = unwrap(declare(spellId), spellId);
    const open = world(declared.events);
    const castingId = pendingCastingsOf(open)[0]!.castingId;

    const tick = unwrap(advanceTime(open, seconds - 1, 'nearly there'), 'tick');
    const early = resolveDeclaredCast(
      fold('seed', [...SETUP, ...declared.events, ...tick]),
      castingId,
      supply(),
    );
    expect(isErr(early) && early.code).toBe('still_casting');
  });
});

describe('a rite runs for ten minutes and the rest of the table carries on', () => {
  /**
   * **The behaviour IE-038 corrected, demonstrated by the twelve that make it
   * matter.** The engine held one pending casting engine-wide and refused
   * every other creature's casting while it stood — written for a Counterspell
   * window open for an instant, and harmless until a casting could be open for
   * ten minutes. SRD lets the cleric cast Cure Wounds while the wizard
   * performs a Ritual, and this is the first fixture in which the wizard's
   * rite is a spell out of the catalogue rather than a hand-built request.
   *
   * Alarm is the rite, cast as a Ritual, because its Ritual is **not** ten
   * minutes: "1 minute or Ritual" plus the Ritual's ten gives 660 seconds,
   * where every definition tagged *before this batch* prints "Action or
   * Ritual" and comes to 600 either way. Five more of the twelve print the
   * same line and come to the same 660 — Alarm is the fixture rather than the
   * only case, and `long-casting.test.ts` is where every one of them is held
   * to the sum.
   */
  it('lets a second creature cast while the wizard is eleven minutes into a Ritual', () => {
    const declared = unwrap(
      resolveSpell(world(), WIZARD, { spellId: 'alarm', targets: [], ritual: true }, supply()),
      'alarm as a ritual',
    );
    const open = world(declared.events);
    const castingId = pendingCastingsOf(open)[0]!.castingId;

    // SRD: "The Ritual version of a spell takes 10 minutes longer to cast than
    // normal." Alarm's normal is a minute, so its Ritual is 660 seconds — the
    // sum rather than the constant, which no other catalogue spell can say.
    expect(pendingCastingsOf(open)[0]?.completesAt).toEqual({ kind: 'elapsed', at: 660 });

    // Half way through the rite, the ally casts. This is the refusal that was
    // there before: `casting_pending`, naming nobody, for the whole eleven
    // minutes.
    const half = unwrap(advanceTime(open, 300, 'the first half of the rite'), 'half');
    const midway = fold('seed', [...SETUP, ...declared.events, ...half]);
    const theirs = unwrap(
      resolveSpell(midway, ALLY, { spellId: 'bless', targets: [ALLY, FOE], slotLevel: 1 }, supply('ally')),
      'the ally casts',
    );
    expect(theirs.events.filter((e) => e.type === 'spell-cast')).toHaveLength(1);

    // And the rite is untouched by it: still open, still the wizard's, still
    // due at the same moment.
    const during = fold('seed', [...SETUP, ...declared.events, ...half, ...theirs.events]);
    expect(pendingCastingsBy(during, WIZARD).map((p) => p.castingId)).toEqual([castingId]);
    expect(pendingCastingsBy(during, ALLY)).toEqual([]);
    expect(during.creatures.wizard!.concentration?.castingId).toBe(castingId);

    // The rest of the rite, and the ward goes up.
    const rest = unwrap(advanceTime(during, 360, 'the rest of the rite'), 'rest');
    const log = [...SETUP, ...declared.events, ...half, ...theirs.events, ...rest];
    const settled = unwrap(
      resolveDeclaredCast(fold('seed', log), castingId, supply()),
      'the ward goes up',
    );

    const done = fold('seed', [...log, ...settled.events]);
    // SRD: "It also doesn't expend a spell slot."
    expect(settled.events.find((e) => e.type === 'spell-cast')).toMatchObject({
      slotless: 'ritual',
      slot: null,
    });
    expect(slots(done, WIZARD, 1)).toBe(4);
    // The ally's level 1 slot did go, which is what says their casting was real.
    expect(slots(done, ALLY, 1)).toBe(3);

    // SRD Alarm: "Duration: 8 hours", and the clock starts when the ward does
    // rather than when the muttering did.
    expect(settled.events.find((e) => e.type === 'effect-scheduled')).toMatchObject({
      deadline: { kind: 'elapsed', at: 660 + 28_800 },
    });
    expect(done.ongoing[settled.castingId!]?.spellId).toBe('alarm');

    // And it really ends: eight hours later there is nothing left standing.
    const after = fold('seed', [
      ...log,
      ...settled.events,
      ...unwrap(advanceTime(done, 28_800, 'the watch'), 'the night'),
    ]);
    expect(after.ongoing[settled.castingId!]).toBeUndefined();
  });
});

describe('the clauses the engine still owns', () => {
  /**
   * SRD Hallucinatory Terrain: "a creature examining the illusion can take the
   * Study action to make an Intelligence (Investigation) check against your
   * spell save DC to disbelieve it." That is the sentence Disguise Self,
   * Minor Illusion and Silent Image already write, so it is the same
   * `SpellCheck` riding on the casting's own timer — and the tracked map says
   * `engine` for it, in both directions.
   */
  it('rolls the Investigation check against Hallucinatory Terrain', () => {
    const declared = unwrap(declare('hallucinatory-terrain'), 'terrain');
    const open = world(declared.events);
    const castingId = pendingCastingsOf(open)[0]!.castingId;
    const tick = unwrap(advanceTime(open, 600, 'the shaping'), 'tick');
    const log = [...SETUP, ...declared.events, ...tick];
    const settled = unwrap(resolveDeclaredCast(fold('seed', log), castingId, supply()), 'settle');
    const standing = fold('seed', [...log, ...settled.events]);

    // The check is *offered*, which is the half a hand-built key cannot show:
    // the casting's own timer carries it, against the DC it was cast at.
    const offered = availableChecks(standing, ALLY);
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({
      ability: 'int',
      skill: 'investigation',
      onSuccess: 'none',
      // "against your spell save DC" — 8 + 4 (proficiency at level 12) + 4 (Int 18).
      dc: 16,
    });

    const looked = unwrap(
      resolveEffectCheck(
        standing,
        ALLY,
        // "a creature examining the illusion" — SRD Hallucinatory Terrain says
        // the difference is not obvious *by touch*, so looking is what the
        // attempt leans on, which a Blinded examiner would fail outright.
        { effectKey: offered[0]!.effectKey, senses: { requiresSight: true } },
        supply('look'),
      ),
      'the ally studies the terrain',
    );
    expect(looked.events.some((e) => e.type === 'roll-recorded')).toBe(true);
    // "onSuccess: 'none'" — seeing through an illusion changes nothing the
    // engine holds, so the roll is the whole of it.
    expect(looked.events.some((e) => e.type === 'spell-ended')).toBe(false);
  });

  /**
   * SRD Identify: "You touch an object throughout the spell's casting... **If
   * you instead touch a creature** throughout the casting, you learn which
   * ongoing spells, if any, are currently affecting it." Two things may be
   * touched and only one of them is a creature, so the target list may name
   * the creature or name nobody — which is exactly `TargetRule.optional`.
   */
  it('lets Identify name the creature it touched, or name nobody', () => {
    expect(unwrap(declare('identify'), 'an object').castingId!.length).toBeGreaterThan(0);
    expect(unwrap(declare('identify', { targets: [ALLY] }), 'a creature').castingId!.length)
      .toBeGreaterThan(0);
  });

  /** And Touch is five feet, checked against the creature actually named. */
  it('refuses an Identify aimed at a creature out of reach', () => {
    const far: readonly GameEvent[] = [
      ...SETUP.filter((e) => !(e.type === 'creature-placed' && e.id === ALLY)),
      {
        type: 'creature-placed',
        id: ALLY,
        placement: { from: { creature: WIZARD }, feet: 15, bearing: 0 },
      },
    ];
    const out = declare('identify', { targets: [ALLY] }, far);
    expect(isErr(out) && out.code).toBe('out_of_range');
  });

  /**
   * SRD Instant Summons and Magic Mouth both print "Duration: Until
   * dispelled", which is the absence of a deadline rather than a large one: no
   * timer is scheduled, and the casting stands until something ends it.
   */
  it.each([['instant-summons'], ['magic-mouth']] as const)(
    'schedules no deadline for %s and still leaves a casting standing',
    (spellId) => {
      const declared = unwrap(declare(spellId), spellId);
      const open = world(declared.events);
      const castingId = pendingCastingsOf(open)[0]!.castingId;
      const tick = unwrap(advanceTime(open, 60, 'the rite'), 'tick');
      const log = [...SETUP, ...declared.events, ...tick];
      const settled = unwrap(resolveDeclaredCast(fold('seed', log), castingId, supply()), 'settle');
      const done = fold('seed', [...log, ...settled.events]);

      expect(defined(spellId).untilDispelled).toBe(true);
      expect(defined(spellId).durationSeconds).toBeUndefined();
      expect(Object.keys(done.timers)).toHaveLength(0);
      expect(done.ongoing[settled.castingId!]?.spellId).toBe(spellId);
    },
  );

  /**
   * SRD Mending is a **cantrip** with a casting time of 1 minute, which is the
   * only combination of the two in the book among these twelve. It declares
   * and settles like the rest and no slot moves in either direction.
   */
  it('runs Mending as a cantrip that takes a minute', () => {
    expect(defined('mending').level).toBe(0);
    const declared = unwrap(declare('mending'), 'mending');
    const open = world(declared.events);
    const castingId = pendingCastingsOf(open)[0]!.castingId;
    const tick = unwrap(advanceTime(open, 60, 'the mending'), 'tick');
    const log = [...SETUP, ...declared.events, ...tick];
    const settled = unwrap(resolveDeclaredCast(fold('seed', log), castingId, supply()), 'settle');

    expect(settled.events.find((e) => e.type === 'spell-cast')).toMatchObject({
      level: 0,
      slot: null,
    });
    // An Instantaneous cantrip leaves nothing behind at all.
    const done = fold('seed', [...log, ...settled.events]);
    expect(done.ongoing).toEqual({});
    expect(Object.keys(done.timers)).toHaveLength(0);
  });

  /** A spell the book does not tag as a Ritual has no Ritual version. */
  it.each(TWELVE.map(([spellId]) => spellId).filter((spellId) => !RITUALS.includes(spellId)))(
    'refuses a Ritual casting of %s',
    (spellId) => {
      const out = declare(spellId, { ritual: true, slotLevel: undefined });
      expect(isErr(out) && out.code).toBe('not_a_ritual');
    },
  );
});
