import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from '@ie/engine';
import {
  advanceTime,
  createRng,
  createRollIssuer,
  declaredCasting,
  dmDecisionsIn,
  fold,
  pendingCastingsOf,
  remaining,
  resolveDeclaredCast,
  resolveSpell,
  spellSlotKey,
  type GameEvent,
  type Rng,
} from '@ie/engine';
import {
  BLOCKED_ON,
  TRACKED_ADJUDICATED,
  clausesIn,
  mechanicalMarkersIn,
  printedFieldsOf,
  printedUnitsOf,
} from '../scripts/missing-shapes.js';

/**
 * Text only the DM can decide, handed over rather than adjudicated.
 *
 * The owner's ruling, verbatim: "**Some text is the DM's alone.** Commune,
 * Dream's Range `Special`, Mirage Arcane's `Sight`: the casting hands the
 * printed text to whoever is running the table, human or model, marked
 * explicitly as a thing only the DM can decide. Not a format arm to invent, a
 * handover to make visible."
 *
 * Three spells, and the three of them were on two different lists for the same
 * wrong reason. Dream and Mirage Arcane sat in `BLOCKED_ON` **under protest** —
 * the entries said in as many words that no shape id named the gap and that
 * inventing one would be an architecture decision rather than a reading — and
 * Commune was written, with a deity's answers filed in `unmodelled` as though
 * somebody would one day build the thing that produces them.
 *
 * Neither filing was true. A question asked of a god, a Range printed `Special`
 * and a Range printed `Sight` are not mechanisms the engine is missing; they
 * are questions it has no business answering. So the printed words go out with
 * the casting under a mark of their own, and everything the casting really owns
 * — the slot, the rite on the clock, the duration, the ongoing record — happens
 * around them exactly as it does for any other spell.
 *
 * ### The sweep the ruling implied, and what it actually found
 *
 * The ruling named three spells and the catalogue was never read for the rest.
 * Augury's omen — "The GM chooses the omen from the Omens table" — sat in
 * `unmodelled` saying in its own words that it was the GM's, which is a debt
 * nobody may ever pay filed on the list of debts somebody might. It was not
 * alone.
 *
 * The sweep was run against two objective anchors rather than by taste. The
 * **Range** half is closed and provably so: exactly three SRD spells print a
 * Range that is not Self, Touch or a number of feet — Dream's `Special`,
 * Mirage Arcane's `Sight` and Sending's `Unlimited` — and Sending is not a
 * handover, because it is blocked on a second plane, a 5-per-cent chance and an
 * effect that suppresses other magic. The **prose** half was anchored on the
 * book naming the GM: twenty-one SRD spells do, nineteen of them are
 * definitions, and each was read line by line against the question the ruling
 * asks — could the engine execute this if somebody built the shape, or is it a
 * fact only a person at the table can supply?
 *
 * Eight came back handovers and are re-filed here. Two rules keep the answer
 * checkable rather than a matter of opinion, and both are asserted below: a
 * handed-over sentence trips **no mechanical marker**, and it is **not a
 * sentence the tracked map already files as a debt**. Where a line was
 * genuinely both — Teleportation Circle's sigil sequences, whose 365 days of
 * daily casting is a count nothing keeps; Awaken's statistics, which are a stat
 * block as well as the GM's choice; Plane Shift's arrival, which is a second
 * place to put a creature; Prismatic Wall's light, which refuses lower-level
 * magic; Control Weather's stage tables, which wait on a delay nothing
 * schedules — the line stayed a debt and this comment is the record of why.
 */

const HANDING_OVER: readonly string[] = SPELL_DEFINITIONS.filter(
  (d) => (d.dmDecides ?? []).length > 0,
).map((d) => d.id);

/** The two whose **Range** is the handover, which is the half with no number. */
const DM_RANGED: readonly string[] = SPELL_DEFINITIONS.filter((d) => d.range.kind === 'dm').map(
  (d) => d.id,
);

/**
 * A casting of a minute or more, which is the only kind that reaches the log.
 *
 * The three the ruling named were all long, so the driver below assumed it.
 * The sweep found two that are not — Divination is an Action or a Ritual and
 * Gate is an Action — and an atomic casting writes `spell-cast`, which carries
 * no text at all. Their handover reaches the caller and not the log, which is
 * the limit `unmodelled` has always had and `SpellDefinition.dmDecides`
 * records; splitting the population here is how that stays a stated fact
 * rather than a test nobody could write.
 */
const LONG: readonly string[] = HANDING_OVER.filter(
  (id) => SRD_CONTENT.spell(id)!.castingTime === 'long',
);
const ATOMIC: readonly string[] = HANDING_OVER.filter(
  (id) => SRD_CONTENT.spell(id)!.castingTime !== 'long',
);

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const SLEEPER = id('sleeper');

const sheet = (): CharacterSheet => ({
  level: 13,
  abilities: { str: 10, dex: 12, con: 14, int: 18, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
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

const SETUP: readonly GameEvent[] = [
  added(CLERIC),
  added(SLEEPER),
  // Every level the handed-over spells are cast at, because the sweep widened
  // the population from three level-5-and-7 rites to eleven spells between
  // level 2 and level 9.
  ...[2, 4, 5, 6, 7, 8, 9].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CLERIC,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 2,
        recovers: 'long-rest',
      },
    }),
  ),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the shrine', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the shrine' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: SLEEPER,
    placement: { from: { creature: CLERIC }, feet: 5, bearing: 0 },
  },
  { type: 'sight-declared', from: CLERIC, to: SLEEPER, seen: true },
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'cleric',
      cantrips: [],
      prepared: SPELL_DEFINITIONS.filter((d) => d.level > 0).map((d) => d.id),
    }),
  },
];

const supply = () => ({
  issuer: createRollIssuer('r'),
  rng: createRng('handover') as Rng,
  content: SRD_CONTENT,
});

/** An Action casting, which lands in one breath and writes no pending record. */
const atomic = (spellId: string, log: readonly GameEvent[] = SETUP) => {
  const definition = SRD_CONTENT.spell(spellId)!;
  const targets = definition.targets.count === 0 ? [] : [SLEEPER];
  const cast = unwrap(
    resolveSpell(
      fold('seed', log),
      CLERIC,
      { spellId, targets, slotLevel: definition.level },
      supply(),
    ),
    `cast ${spellId}`,
  );
  return { cast, log: [...log, ...cast.events], unverified: [...cast.unverified] };
};

/**
 * One of the long ones, cast the whole way: declared, held on the clock for the
 * rite the book prints, and settled.
 *
 * Nine of the eleven take a minute or more, so none of those lands in one
 * breath — and driving the whole casting is the only way to say that the
 * handover survives the round trip through the log rather than being a string a
 * command returned.
 */
const driven = (spellId: string, log: readonly GameEvent[] = SETUP) => {
  const definition = SRD_CONTENT.spell(spellId)!;
  const targets = definition.targets.count === 0 ? [] : [SLEEPER];
  const declared = unwrap(
    resolveSpell(
      fold('seed', log),
      CLERIC,
      { spellId, targets, slotLevel: definition.level },
      supply(),
    ),
    `declare ${spellId}`,
  );

  const open = fold('seed', [...log, ...declared.events]);
  const castingId = pendingCastingsOf(open)[0]!.castingId;
  const tick = unwrap(
    advanceTime(open, definition.castingSeconds!, 'the rite'),
    `the rite of ${spellId}`,
  );
  const ticked = [...log, ...declared.events, ...tick];
  const settled = unwrap(
    resolveDeclaredCast(fold('seed', ticked), castingId, supply()),
    `settle ${spellId}`,
  );
  return {
    castingId,
    declared,
    open,
    log: [...ticked, ...settled.events],
    settled,
    unverified: [...declared.unverified, ...settled.unverified],
  };
};

describe('the catalogue hands over exactly the text it means to', () => {
  it('is the three the ruling named and the eight the sweep found', () => {
    expect([...HANDING_OVER].sort()).toEqual([
      'augury',
      'commune',
      'commune-with-nature',
      'contact-other-plane',
      'control-weather',
      'divination',
      'dream',
      'gate',
      'legend-lore',
      'mirage-arcane',
      'planar-ally',
    ]);
    // And the Range half did not grow, because it was already complete: three
    // SRD spells print a Range that is not Self, Touch or a number of feet, and
    // the third is Sending — whose `Unlimited` the `dm` arm would carry and
    // whose blockers are three mechanisms it would not. It stays undefined and
    // stays in the map, which is the counter-example that keeps `range: 'dm'`
    // from becoming the arm every awkward Range goes into.
    expect([...DM_RANGED].sort()).toEqual(['dream', 'mirage-arcane']);
    expect(SRD_CONTENT.spell('sending')).toBeNull();
    expect(clausesIn(BLOCKED_ON['sending'] ?? []).map((entry) => entry.why)).toEqual([
      'table',
      'a-second-place-to-put-a-creature',
      'a-random-outcome-that-is-not-a-d20',
      'an-effect-that-suppresses-other-magic',
    ]);
  });

  /**
   * **Verbatim, and provably so.** A handover that paraphrased the book would
   * be the engine having an opinion about text it just said was not its own,
   * so every sentence handed over has to be one the SRD prints — either a
   * printed field (`Range: Sight`) or a sentence of the spell's own prose.
   */
  it.each(HANDING_OVER.map((s) => [s] as const))('quotes %s word for word', (spellId) => {
    const units = printedUnitsOf(spellId);
    for (const printed of SRD_CONTENT.spell(spellId)!.dmDecides ?? []) {
      expect(units, `${spellId}: "${printed}"`).toContain(printed);
    }
  });

  /**
   * And a Range the DM decides hands over the Range, which is the one thing it
   * could otherwise fail to mention: a casting that measured nothing and said
   * nothing would be the silent success the ruling exists to refuse.
   */
  it.each(DM_RANGED.map((s) => [s] as const))('hands over the printed Range of %s', (spellId) => {
    const printed = printedFieldsOf(spellId).find((field) => field.startsWith('Range: '));
    expect(SRD_CONTENT.spell(spellId)!.dmDecides ?? [], spellId).toContain(printed);
  });

  /**
   * The two lists say different things, so nothing may sit in both. A clause
   * recorded as a debt *and* handed over would be counted as work somebody may
   * do and disowned in the same breath.
   */
  it.each(HANDING_OVER.map((s) => [s] as const))('files %s’s two lists apart', (spellId) => {
    const definition = SRD_CONTENT.spell(spellId)!;
    const gaps = new Set(definition.unmodelled ?? []);
    expect((definition.dmDecides ?? []).filter((printed) => gaps.has(printed))).toEqual([]);
  });

  /**
   * **The first of the two rules that make the sweep checkable.**
   *
   * The judgement the ruling asks for — could the engine execute this if
   * somebody built the shape, or is it a fact only a person at the table can
   * supply? — is a reading, and a reading nobody can check is how a handover
   * becomes the bin an awkward mechanic goes into. So it is anchored to the
   * marker list the tracked bucket has always been held to: dice, a saving
   * throw, an ability check, an Armour Class, Hit Points, a defence, a
   * condition, a roll mode, a Speed, a percentage, a cost in feet, a teleport,
   * extra damage. A sentence naming one of those is a claim about mechanics,
   * and mechanics are not handed over. Every sentence of every handover is
   * clean of all thirteen.
   */
  it.each(HANDING_OVER.map((s) => [s] as const))('names no mechanic in %s’s handover', (spellId) => {
    for (const printed of SRD_CONTENT.spell(spellId)!.dmDecides ?? []) {
      expect(mechanicalMarkersIn(printed), `${spellId}: "${printed}"`).toEqual([]);
    }
  });

  /**
   * **The second: nothing handed over is a sentence already filed as a debt.**
   *
   * `TRACKED_ADJUDICATED` anchors each entry to a distinctive phrase of the
   * spell's own printed text, so a handover that contained one of those phrases
   * would be the same sentence counted as work somebody may do and disowned in
   * the same breath — the failure the two-lists-apart rule above forbids
   * *within* a definition, arriving from the map instead.
   *
   * This is the rule that kept Control Weather's stage tables a debt. "When you
   * change the weather conditions, find a current condition on the following
   * tables and change its stage by one, up or down" is the DM's *and* waits on
   * the `1d4 × 10 minutes` nothing schedules, and the tracked map says so; the
   * sentences around it, which are only the weather, are handed over.
   *
   * **And it found one breach on the day it was written, which is recorded
   * rather than exempted** — the discipline `origin-and-feature-sweep.test.ts`
   * already keeps. Mirage Arcane's opening sentence is a handover with a debt
   * inside it: what the terrain looks, sounds, smells and feels like is the
   * DM's, and "in an area up to 1 mile square" is a size chosen at the casting
   * that a `SpellArea` cannot record. It went out with the ruling's own three,
   * before there was a rule for it to break. The record is one entry long and
   * the guard bites on everything else, so a second one is an argument somebody
   * has to have rather than a line that slips in.
   */
  const BOTH: readonly (readonly [string, string])[] = [
    ['mirage-arcane', 'in an area up to 1 mile square'],
  ];

  it.each(HANDING_OVER.map((s) => [s] as const))(
    'hands over nothing %s files as a debt',
    (spellId) => {
      const recorded = BOTH.filter(([id]) => id === spellId).map(([, anchor]) => anchor);
      const anchors = (TRACKED_ADJUDICATED[spellId] ?? [])
        .map((entry) => entry.clause)
        .filter((anchor) => !recorded.includes(anchor));
      for (const printed of SRD_CONTENT.spell(spellId)!.dmDecides ?? []) {
        expect(
          anchors.filter((anchor) => printed.includes(anchor)),
          `${spellId}: "${printed}"`,
        ).toEqual([]);
      }
    },
  );

  /** And the record is a record: every entry in it is a real overlap. */
  it.each(BOTH)('records %s’s clause that is both', (spellId, anchor) => {
    expect((TRACKED_ADJUDICATED[spellId] ?? []).map((entry) => entry.clause)).toContain(anchor);
    expect(
      (SRD_CONTENT.spell(spellId)!.dmDecides ?? []).filter((printed) => printed.includes(anchor)),
    ).toHaveLength(1);
  });
});

/**
 * Re-filing moves a line between two lists and must move nothing else.
 *
 * The eight the sweep found were all **tracked** definitions with debts of
 * their own, and a re-filing that quietly dropped one would shrink the blocker
 * map by deleting a gap rather than by building it. So what each spell claimed
 * before is pinned here, by shape, beside the count of sentences it now hands
 * over: every one of them is still out of `BLOCKED_ON`, still claims exactly
 * the shapes it claimed, and still says what it owes.
 */
describe('the sweep re-filed lines and retired no debt', () => {
  const REFILED: readonly (readonly [string, readonly string[], number])[] = [
    // Augury's one shape was built: the percentage is a `chance` effect now
    // and it claims none. The re-filing is what this row is about and it still
    // holds — the omen is handed over and nothing was deleted to get here.
    ['augury', [], 3],
    ['commune-with-nature', [], 7],
    [
      'contact-other-plane',
      ['a-dc-the-caster-does-not-set', 'a-dc-the-caster-does-not-set', 'a-deadline-anchored-to-a-rest'],
      4,
    ],
    [
      'control-weather',
      ['a-random-outcome-that-is-not-a-d20', 'a-random-outcome-that-is-not-a-d20'],
      4,
    ],
    ['divination', ['a-random-outcome-that-is-not-a-d20'], 4],
    ['gate', [], 1],
    ['legend-lore', [], 6],
    ['planar-ally', [], 16],
  ];

  it.each(REFILED)('keeps %s’s filing whole', (spellId, shapes, handed) => {
    expect(BLOCKED_ON[spellId], spellId).toBeUndefined();
    expect((TRACKED_ADJUDICATED[spellId] ?? []).map((entry) => entry.why), spellId).toEqual(shapes);
    expect((SRD_CONTENT.spell(spellId)!.dmDecides ?? []).length, spellId).toBe(handed);
  });

  /**
   * And the distinction the re-filing drew has survived the debt being paid.
   *
   * Augury's `unmodelled` line named the percentage and its `dmDecides` names
   * the omen, and the whole of that brief was that the two are different kinds
   * of thing: a debt somebody may pay, and a question nobody here will ever
   * answer. The percentage was paid — it is a `chance` effect — so the debt is
   * gone and the handover is untouched, which is the line holding rather than
   * the line disappearing.
   */
  it('executes Augury’s percentage and still hands over the omen', () => {
    const augury = SRD_CONTENT.spell('augury')!;
    expect(augury.unmodelled ?? []).toEqual([]);
    expect(augury.effects.map((effect) => effect.kind)).toEqual(['chance']);
    expect(augury.dmDecides ?? []).toContain('The GM chooses the omen from the Omens table.');
  });
});

describe('each of the eleven is cast, and hands its own text to the table', () => {
  it.each(LONG.map((s) => [s] as const))(
    'carries every printed sentence of %s out of the casting',
    (spellId) => {
      const definition = SRD_CONTENT.spell(spellId)!;
      const out = driven(spellId);
      expect(dmDecisionsIn(out.unverified)).toEqual(
        // Once at the declaration and once at the settlement, because both
        // halves of a long casting report what the spell left to the table.
        [...(definition.dmDecides ?? []), ...(definition.dmDecides ?? [])],
      );
      // And the gaps are still gaps, under no mark at all.
      for (const gap of definition.unmodelled ?? []) {
        expect(out.unverified).toContain(`${definition.name}: ${gap}`);
      }
    },
  );

  /** The same of the two that land in one breath, which report once. */
  it.each(ATOMIC.map((s) => [s] as const))(
    'carries every printed sentence of %s out of an Action casting',
    (spellId) => {
      const definition = SRD_CONTENT.spell(spellId)!;
      const out = atomic(spellId);
      expect(dmDecisionsIn(out.unverified)).toEqual([...(definition.dmDecides ?? [])]);
      for (const gap of definition.unmodelled ?? []) {
        expect(out.unverified).toContain(`${definition.name}: ${gap}`);
      }
    },
  );

  /**
   * The slot goes, the clock runs, and a spell with a duration is still
   * standing after it.
   *
   * The three the ruling named all had one; five of the eight the sweep found
   * are Instantaneous, and an Instantaneous rite leaves nothing behind. So the
   * ongoing record is asserted of the definitions that print a Duration and its
   * **absence** is asserted of the ones that do not — which is the half a
   * widened population would otherwise have quietly stopped checking.
   */
  it.each(LONG.map((s) => [s] as const))('adjudicates what it owns for %s', (spellId) => {
    const definition = SRD_CONTENT.spell(spellId)!;
    const out = driven(spellId);
    const after = fold('seed', out.log);
    expect(remaining(after.creatures.cleric!.resources, spellSlotKey(definition.level))).toBe(1);
    expect(Object.keys(after.ongoing)).toEqual(
      definition.durationSeconds === undefined ? [] : [out.castingId],
    );
    // **Nothing landed on anybody**, which was ten of these spells and is now
    // ten of eleven: every one is a rite whose whole content is the text it
    // hands over. Augury is the exception and is the honest kind — its
    // `chance` effect reports what it decided about this casting's handover,
    // which is an outcome about the caster rather than something done to
    // somebody else.
    expect(out.settled.outcomes).toEqual(
      definition.effects.length === 0 ? [] : [{ target: asCharacterId('cleric'), affected: false }],
    );
  });

  it.each(ATOMIC.map((s) => [s] as const))('spends a slot for %s', (spellId) => {
    const definition = SRD_CONTENT.spell(spellId)!;
    const out = atomic(spellId);
    const after = fold('seed', out.log);
    expect(remaining(after.creatures.cleric!.resources, spellSlotKey(definition.level))).toBe(1);
    expect(out.cast.outcomes).toEqual([]);
  });

  /**
   * And the text is in the **log**: the declaration pins what the command read
   * from the catalogue, so the fold below is handed no content at all and
   * still knows what the table was asked.
   *
   * Long castings only, and that is the stated limit rather than an oversight.
   * `PendingCasting.unverified` is written onto `spell-declared` and
   * `spell-cast` carries no text at all, so Divination's and Gate's handovers
   * reach their caller and not their log — which is what `dmDecides` says of
   * itself, and closing it is a field on an event rather than a line here.
   */
  it.each(LONG.map((s) => [s] as const))(
    'folds %s’s handover back with no catalogue open',
    (spellId) => {
      const definition = SRD_CONTENT.spell(spellId)!;
      const out = driven(spellId);
      const pending = out.open.pendingCastings[out.castingId];
      expect(dmDecisionsIn(pending!.unverified)).toEqual([...(definition.dmDecides ?? [])]);
    },
  );

  it.each(ATOMIC.map((s) => [s] as const))('writes no pending record for %s', (spellId) => {
    const out = atomic(spellId);
    expect(Object.keys(fold('seed', out.log).pendingCastings)).toEqual([]);
  });

  /**
   * SRD Dream's Range is `Special` and its target is "a creature you know on
   * the same plane of existence" — so a spell that measured a distance would
   * refuse a target the book allows. Driven at a creature outside every range
   * the book prints, because the pass has to be the handover rather than a
   * table that happened to be small.
   */
  it('measures no distance for Dream, whose Range the book left to the DM', () => {
    const faraway: readonly GameEvent[] = SETUP.map((event) =>
      event.type === 'scene-set'
        ? { type: 'scene-set', extent: { width: 4000, depth: 4000, height: 40 } }
        : event.type === 'creature-placed' && event.id === SLEEPER
          ? {
              type: 'creature-placed',
              id: SLEEPER,
              placement: { from: { creature: CLERIC }, feet: 3000, bearing: 0 },
            }
          : event,
    );
    const out = driven('dream', faraway);
    expect(dmDecisionsIn(out.unverified)).toContain('Range: Special');
    expect(Object.keys(fold('seed', out.log).ongoing)).toEqual([out.castingId]);
  });
});
