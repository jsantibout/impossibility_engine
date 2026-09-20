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
import { printedFieldsOf, printedUnitsOf } from '../scripts/missing-shapes.js';

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
 */

const HANDING_OVER: readonly string[] = SPELL_DEFINITIONS.filter(
  (d) => (d.dmDecides ?? []).length > 0,
).map((d) => d.id);

/** The two whose **Range** is the handover, which is the half with no number. */
const DM_RANGED: readonly string[] = SPELL_DEFINITIONS.filter((d) => d.range.kind === 'dm').map(
  (d) => d.id,
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
  ...[5, 7].map(
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

/**
 * One of the three, cast the whole way: declared, held on the clock for the
 * rite the book prints, and settled.
 *
 * All three take a minute or more, so none of them lands in one breath — and
 * driving the whole casting is the only way to say that the handover survives
 * the round trip through the log rather than being a string a command returned.
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
  it('is the three spells the ruling names, and no others yet', () => {
    expect([...HANDING_OVER].sort()).toEqual(['commune', 'dream', 'mirage-arcane']);
    expect([...DM_RANGED].sort()).toEqual(['dream', 'mirage-arcane']);
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
});

describe('each of the three is cast, and hands its own text to the table', () => {
  it.each(HANDING_OVER.map((s) => [s] as const))(
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

  /** The slot goes, the clock runs, and the spell is still standing after it. */
  it.each(HANDING_OVER.map((s) => [s] as const))('adjudicates what it owns for %s', (spellId) => {
    const definition = SRD_CONTENT.spell(spellId)!;
    const out = driven(spellId);
    const after = fold('seed', out.log);
    expect(remaining(after.creatures.cleric!.resources, spellSlotKey(definition.level))).toBe(1);
    expect(Object.keys(after.ongoing)).toEqual([out.castingId]);
    expect(out.settled.outcomes).toEqual([]);
  });

  /**
   * And the text is in the **log**: the declaration pins what the command read
   * from the catalogue, so the fold below is handed no content at all and
   * still knows what the table was asked.
   */
  it.each(HANDING_OVER.map((s) => [s] as const))(
    'folds %s’s handover back with no catalogue open',
    (spellId) => {
      const definition = SRD_CONTENT.spell(spellId)!;
      const out = driven(spellId);
      const pending = out.open.pendingCastings[out.castingId];
      expect(dmDecisionsIn(pending!.unverified)).toEqual([...(definition.dmDecides ?? [])]);
    },
  );

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
