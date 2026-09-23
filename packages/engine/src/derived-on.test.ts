import { readFileSync } from 'node:fs';
import { SRD_CONTENT } from '@ie/content';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, applyEventWith, fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { holdsNothingOf, spellOn } from './fold/release.js';
import type { OngoingSpell } from './spells.js';
import { endOngoingSpell, ongoingSpellsOn, resolveSpell } from './commands.js';

/**
 * Which half of "what is this casting on" the world can answer, and which half
 * only the cast knows.
 *
 * The rule is one sentence and the whole engine states it:
 *
 * > A casting is on a creature while it has a live effect there that the
 * > casting owns.
 *
 * `holdsNothingOf` computes exactly that, and the question this file was
 * written to settle is whether it computes the **whole** of it — whether the
 * stored list could simply go. It was the gate: written before anything was
 * removed, which is the whole of why its answer is worth anything.
 *
 * **The answer was no, and it is why `OngoingSpell.aimed` exists.** The
 * measurement is preserved below, in the three fixtures that carry it. A
 * *tracked* spell owns nothing on its target ever, so the rule alone answers
 * nobody and Darkvision stops being dispellable; and a target the casting was
 * released on rules out the obvious rescue, a derivation seeded from the
 * cast-time list. Neither reading is available alone, so the field is **two
 * facts of different provenance**: the half only the cast knows is stored
 * under a name that cannot be mistaken for "on now", and the half the world
 * holds is asked of the world at every read. `spellOn` is the union, and the
 * one answer all four readers take.
 *
 * So what this file guards is no longer a decision but a pair of claims:
 *
 * | | |
 * |---|---|
 * | the engine's answer still matches the world-only reading over the frozen logs | 869 checkpoints on `golden-log-2.json`, 0 mismatches |
 * | and it is byte for byte what the engine answered when the field was stored whole | the pinned traces at the end of this file |
 *
 * **And the gate found the bug it was written to prevent, already live** — a
 * `grants` deadline released a grant and left the name in the stored list,
 * where the condition branch removed it. Its fixture asserted that
 * *disagreement*, and said a fix should be expected to redden it. This is that
 * fix, so the fixture now asserts the agreement: the shrink is gone from
 * `fold/expiry.ts` altogether, and both branches are right by construction.
 */

const here = fileURLToPath(new URL('.', import.meta.url));

const read = (name: string): readonly GameEvent[] =>
  JSON.parse(readFileSync(`${here}../fixtures/${name}`, 'utf8')) as GameEvent[];

const GOLDEN_1: readonly GameEvent[] = read('golden-log.json');
const GOLDEN_2: readonly GameEvent[] = read('golden-log-2.json');

/**
 * What the **world alone** says the casting is on, read live.
 *
 * The rule asked of every creature, plus the one part of it the world cannot
 * recover: SRD Vampiric Touch is Range: Self and holds nothing on the wizard,
 * so the casting is on somebody it owns nothing of. That half is taken off the
 * stored value; everything else is asked of the world.
 *
 * **It is kept, and it is deliberately not a copy of `spellOn`.** `spellOn`
 * takes the whole of the stored subset; this takes only the caster out of it.
 * So the two part company exactly where the stored subset holds somebody who
 * is not the caster — the tracked-spell bucket, which is the population that
 * falsified deriving the field. Comparing them over a log is therefore a real
 * question with a real answer, and the answer for both frozen logs is "no such
 * name anywhere", which is why they agree at every checkpoint below and why
 * the three fixtures that follow had to be written by hand.
 *
 * It lives here rather than in `src/` because nothing in the engine wants it:
 * it is the reading that was measured and rejected, and a copy of it there
 * would be a second answer to a question that now has one.
 */
const derivedOn = (state: GameState, record: OngoingSpell): readonly string[] =>
  [
    ...new Set<string>([
      ...record.aimed.filter(
        (who) => who === record.caster && state.creatures[who] !== undefined,
      ),
      ...Object.keys(state.creatures)
        .map((key) => state.creatures[key]!)
        .filter((creature) => !holdsNothingOf(state, creature.id, record.castingId))
        .map((creature) => creature.id),
    ]),
  ].sort();

/** Every disagreement between the engine's answer and the derivation, per event. */
interface Checked {
  readonly checkpoints: number;
  readonly mismatches: readonly string[];
  /** Who each live casting was on, at every step — see the pinned traces. */
  readonly trace: string;
}

/**
 * Fold a log one event at a time, comparing every live record after each.
 *
 * A checkpoint is one `(prefix, casting)` pair rather than one prefix, because
 * the question is asked of each record: a log with five castings running gives
 * five answers at every event, and a count of prefixes would hide four of them.
 */
function checkEveryEvent(seed: string, log: readonly GameEvent[]): Checked {
  let state = fold(seed, []);
  let checkpoints = 0;
  const mismatches: string[] = [];
  const steps: string[] = [];

  const compare = (at: number): void => {
    const line: string[] = [];
    for (const castingId of Object.keys(state.ongoing).sort()) {
      const record = state.ongoing[castingId]!;
      checkpoints += 1;
      const engine = spellOn(state, record).join(',');
      const derived = derivedOn(state, record).join(',');
      if (engine !== derived) {
        mismatches.push(`#${at} ${castingId} ${record.spellId} [${engine}] vs [${derived}]`);
      }
      line.push(`${castingId}:${engine}`);
    }
    steps.push(line.join('|'));
  };

  compare(0);
  const step = applyEventWith(SRD_CONTENT);
  log.forEach((event, index) => {
    state = step(state, event);
    compare(index + 1);
  });

  return { checkpoints, mismatches, trace: steps.join('\n') };
}

/**
 * A stable digest of a whole trace, so "byte-identical" is one pinned number.
 *
 * FNV-1a, written out rather than imported: `node:crypto` would be an import
 * for a hash whose only requirement is that it is the same number on every
 * machine and in every version of Node, and thirty-two bits is ample for
 * telling one trace from another with the length pinned beside it.
 */
const digestOf = (text: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};

describe('the frozen logs agree with the derivation at every event', () => {
  /**
   * 869 checkpoints, 0 mismatches — IE-047's measurement, reproduced with the
   * engine's own `spellOn` where the stored field used to be.
   *
   * The floor is what makes it mean something: a fold that stopped producing
   * ongoing records would pass a mismatch count of zero while checking
   * nothing, which is the vacuity failure every sweep here is driven against.
   *
   * **What the agreement says, now that the field is two halves.** Every
   * casting in this log hung something on everyone it caught, so the stored
   * half is empty throughout and the world answers all 869 checkpoints on its
   * own. That is a fact about the log rather than about the engine — the three
   * fixtures below are the shapes it does not contain — and it is exactly why
   * this is a compatibility check and not a proof of the rule.
   */
  it('checks golden-log-2 at 869 checkpoints and finds nothing', () => {
    const checked = checkEveryEvent('golden-2', GOLDEN_2);
    expect(checked.checkpoints).toBe(869);
    expect(checked.mismatches).toEqual([]);
  });

  /**
   * And the older log checks **nothing at all**, which is worth pinning rather
   * than leaving as a green tick beside the other one. It was written before a
   * casting left a live record behind, so it holds none; a reader taking two
   * passing assertions as two pieces of evidence would be taking one.
   */
  it('checks golden-log at no checkpoints, because it holds no ongoing record', () => {
    const checked = checkEveryEvent('golden', GOLDEN_1);
    expect(checked.checkpoints).toBe(0);
    expect(checked.mismatches).toEqual([]);
  });
});

/**
 * And both logs fold to the answers the engine gave before the field was
 * split — every casting, after every event, byte for byte.
 *
 * This is the assertion the compatibility path actually rests on, and neither
 * of the two above is it. The records in these logs are **pre-versioned**:
 * they carry the whole of "on" where `aimed` now is, so the `spell-ongoing`
 * reducer computes the stored subset out of state as it folds them. Whether
 * that reconstruction is right is not a question about the rule — it is a
 * question about whether the same names come out, and the only way to ask it
 * is to have recorded what came out before.
 *
 * So the traces below were captured from the engine at 04a5353, reading the
 * stored `on` at every step, and they are what these digests are of. A change
 * here is either a compatibility break or a deliberate change to what Dispel
 * Magic finds; it is never a fixture to be refreshed, for the same reason the
 * logs themselves are never regenerated.
 *
 * The lengths are pinned beside the digests because a digest of nothing is
 * still a digest: the first log's trace is 93 newlines and no content at all,
 * 94 steps not one of which holds a record.
 */
describe('and both fold to the readers’ answers the stored field gave', () => {
  it('answers for golden-log-2 exactly as the stored field did', () => {
    const checked = checkEveryEvent('golden-2', GOLDEN_2);
    expect(checked.trace.length).toBe(11425);
    expect(digestOf(checked.trace)).toBe('01734531');
  });

  it('answers for golden-log the same nothing it always answered', () => {
    const checked = checkEveryEvent('golden', GOLDEN_1);
    expect(checked.trace.length).toBe(93);
    expect(digestOf(checked.trace)).toBe('f2b7753d');
  });
});

// — what the frozen logs could not see ————————————————————————————————————————

const CASTER = asCharacterId('caster');
const ALLY = asCharacterId('ally');
const FOE = asCharacterId('foe');

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 14, con: 16, int: 10, wis: 18, cha: 10 },
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
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

// Tongues stands where Darkvision stood: the Darkvision spell confers a sense
// now, so the casting owns something on its target, and the fixture wants a
// tracked touch spell that owns nothing at all.
const PREPARED = ['darkvision', 'tongues', 'bless', 'stoneskin', 'divine-favor'];

const SETUP: readonly GameEvent[] = [
  added(CASTER),
  added(ALLY),
  added(FOE),
  ...[1, 2, 3, 4].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CASTER,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 4,
        recovers: 'long-rest',
      },
    }),
  ),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the ford', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'the ford' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: ALLY,
    placement: { from: { creature: CASTER }, feet: 5, bearing: 0 },
  },
  {
    type: 'creature-placed',
    id: FOE,
    placement: { from: { creature: CASTER }, feet: 5, bearing: 90 },
  },
  { type: 'sight-declared', from: CASTER, to: ALLY, seen: true },
  { type: 'sight-declared', from: CASTER, to: FOE, seen: true },
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'cleric',
      cantrips: [],
      prepared: PREPARED,
    }),
  },
];

const base = (): GameState => fold('derived-on', SETUP);

const must = <T,>(result: Result<T>): T => unwrap(result, 'derived on');

const supply = (seed = 'cast') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const applyAll = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce(applyEventWith(SRD_CONTENT), state);

/**
 * Three cases the pair of frozen logs does not contain, and the whole suite
 * does.
 *
 * These are what the instrumented run found. Each is pinned as a fixture
 * rather than left in prose, because the next reader of this corner needs the
 * counterexample and not a claim that one exists.
 */
describe('and three cases they do not contain', () => {
  /**
   * **A tracked spell keeps its targets and owns nothing on them.** SRD
   * Darkvision has no effect the engine resolves, so `resolveEffects` reports
   * nothing about the creature it was cast on and `landedOn` keeps them — which
   * is CLAUDE.md's own "a tracked spell resolves nothing and keeps all its
   * targets, which is how Darkvision stays dispellable."
   *
   * The casting therefore holds nothing there for ever, so a derivation that
   * reads the world alone answers **nobody** and Darkvision stops being
   * dispellable. Most of what the instrumented run reported is this, across
   * eleven tracked spells — Darkvision, Fly, Tongues, Jump, Message, Spider
   * Climb, Water Walk, Water Breathing, True Seeing, Telepathic Bond and
   * Nondetection. The spells are the durable half of that sentence and a count
   * would not be: it was one run of a probe that is not in the tree.
   */
  it('a tracked spell is on a target the casting owns nothing of', () => {
    const cast = must(
      resolveSpell(base(), CASTER, { spellId: 'tongues', targets: [ALLY], slotLevel: 3 }, supply()),
    );
    const after = applyAll(base(), cast.events);
    const record = after.ongoing[cast.castingId!]!;

    // The stored half carries the whole of it, because there is nothing else
    // that could — and Dispel Magic still finds the spell.
    expect(record.aimed).toEqual([ALLY]);
    expect(spellOn(after, record)).toEqual([ALLY]);
    expect(ongoingSpellsOn(after, ALLY).map((o) => o.castingId)).toEqual([cast.castingId]);

    // The casting owns nothing on them, so the world alone says nobody. That
    // is the falsification, and it is why the stored half was kept.
    expect(holdsNothingOf(after, ALLY, cast.castingId!)).toBe(true);
    expect(derivedOn(after, record)).toEqual([]);
  });

  /**
   * **And releasing a tracked spell on its target is what `withoutTarget`
   * exists for**, which is the other half of the fixture above and the only
   * thing in the engine that edits the stored subset.
   *
   * Every other release settles itself: a Bless dispelled on one of two
   * creatures loses its bonus there in the same breath, so the world stops
   * naming them and nothing has to be unwritten. A tracked spell holds
   * *nothing* anywhere — that is the whole of what makes it the row above — so
   * there is no grant to lose and no condition to lift. The stored half is the
   * only record that the casting was ever on them, and if it were not edited
   * the casting would answer "on them" for ever, which is precisely the stale
   * name Dispel Magic reads that this shape was built to stop.
   *
   * SRD Darkvision is a time span with no Concentration, so `endOngoingSpell`
   * can name it and the casting carries on: this is a release on one creature,
   * not the spell ending.
   */
  it('a tracked spell released on its target leaves the stored half', () => {
    const cast = must(
      resolveSpell(base(), CASTER, { spellId: 'tongues', targets: [ALLY], slotLevel: 3 }, supply()),
    );
    const during = applyAll(base(), cast.events);
    const castingId = cast.castingId!;
    expect(during.ongoing[castingId]?.aimed).toEqual([ALLY]);

    const released = applyAll(during, must(endOngoingSpell(during, CASTER, castingId, ALLY)));
    const record = released.ongoing[castingId];

    // The casting is still running — a release on one creature is not the
    // spell ending — and it is on nobody at all.
    expect(record).toBeDefined();
    expect(record?.aimed).toEqual([]);
    expect(spellOn(released, record!)).toEqual([]);
    expect(ongoingSpellsOn(released, ALLY)).toEqual([]);

    // And there was nothing in the world to change: the casting owned nothing
    // on them before the release and owns nothing after, so the stored half is
    // the only thing that could have said the release happened.
    expect(holdsNothingOf(during, ALLY, castingId)).toBe(true);
    expect(holdsNothingOf(released, ALLY, castingId)).toBe(true);
  });

  /**
   * **A released target is removed, and the rule alone cannot put them back.**
   * That direction is the one the derivation gets right and a *seeded*
   * derivation — the cast-time list unioned with what is held now — gets wrong:
   * Dispel Magic aimed at one of two blessed creatures takes the bonus away,
   * so the world says no and the seed says yes.
   *
   * Recorded here because it is what rules out the obvious alternative. The
   * shape turns up under that reading in Bless, Hold Person, Black Tentacles,
   * Charm Person, Suggestion, Hypnotic Pattern, Stoneskin and Sunbeam — a
   * different population from the one above, counted under a different
   * derivation, which is exactly why neither carries a number.
   */
  it('a released target is gone from the world, and was never in the stored half', () => {
    const cast = must(
      resolveSpell(base(), CASTER, { spellId: 'bless', targets: [ALLY, FOE], slotLevel: 1 }, supply()),
    );
    const during = applyAll(base(), cast.events);
    const castingId = cast.castingId!;
    expect(spellOn(during, during.ongoing[castingId]!)).toEqual([ALLY, FOE].sort());

    const released = applyAll(during, must(endOngoingSpell(during, CASTER, castingId, ALLY)));
    const record = released.ongoing[castingId]!;

    // Both readings agree, and the release had nothing to unwrite: Bless hangs
    // its bonus on both, so neither was ever in the stored half and the world
    // is the only thing that had to change.
    expect(spellOn(released, record)).toEqual([FOE]);
    expect(derivedOn(released, record)).toEqual([FOE]);
    expect(record.aimed).toEqual([]);
    expect(
      cast.events.flatMap((e) => (e.type === 'spell-ongoing' ? [...(e.casting.aimed ?? [])] : [])),
    ).toEqual([]);

    // And this is what rules out the obvious rescue for the row above. A
    // derivation seeded from the **cast-time** list — the whole of "on" rather
    // than the subset — would put ALLY back: the world says no and the seed
    // says yes. It is why the stored half is "on" minus what the casting
    // holds, and why `withoutTarget` still edits it.
    expect(spellOn(released, record)).not.toEqual([ALLY, FOE].sort());
  });

  /**
   * **And the `grants` deadline, which is where the stored value went stale.**
   * This fixture asserted that staleness; it now asserts the agreement, which
   * is the same test measuring the same thing after the fix it predicted.
   *
   * What it found: `expireEffects` shrank `on` in its **condition** branch and
   * in no other, so a `grants` deadline arriving took the Resistance off the
   * creature and left the casting claiming to be on them. `holdsNothingOf`
   * said otherwise in the same breath, and `ongoingSpellsOn` reported a
   * Stoneskin that a Dispel Magic aimed at that fighter would then end. Its
   * own docstring said whoever fixed `fold/expiry.ts` should expect it to go
   * red, and that this would be the test doing its job.
   *
   * **The fix is not the missing shrink.** Both shrinks are gone: the casting
   * is on whoever holds something of its, asked at every read, so releasing
   * the last grant removes them and no branch has to remember to say so. A
   * hand-written pass that was right in one of two places is exactly the shape
   * this repository keeps finding wrong, and adding the second copy would have
   * left the third to be found later.
   *
   * It stays **latent** either way, which is why the assertion below is worth
   * as much as it is and no more. A `grants` timer has one runtime writer —
   * the `speed-change` rider's `lasts` — and Ray of Frost is the only
   * definition that writes one, a cantrip that leaves no ongoing record at
   * all. So no registered spell reaches this, which is why the
   * `effect-scheduled` below is written by hand.
   */
  it('a grants deadline takes the creature off every reading at once', () => {
    const cast = must(
      resolveSpell(base(), CASTER, { spellId: 'stoneskin', targets: [ALLY], slotLevel: 4 }, supply()),
    );
    const during = applyAll(base(), cast.events);
    const castingId = cast.castingId!;
    const source = during.creatures[ALLY]!.grantedDefenses[0]!.source;

    const scheduled = applyEvent(during, {
      type: 'effect-scheduled',
      target: { kind: 'grants', on: ALLY, source },
      deadline: { kind: 'elapsed', at: 6 },
    });
    const later = applyEvent(scheduled, { type: 'time-advanced', seconds: 6, reason: 'the round' });

    // The grant is gone and the casting owns nothing there.
    expect(later.creatures[ALLY]?.grantedDefenses).toEqual([]);
    expect(holdsNothingOf(later, ALLY, castingId)).toBe(true);

    // All three readings agree, which is the fix. The stored half never held
    // them — Stoneskin's Resistance is a grant, so the cast wrote nothing —
    // and the derived half stopped the moment the grant did.
    expect(later.ongoing[castingId]?.aimed).toEqual([]);
    expect(spellOn(later, later.ongoing[castingId]!)).toEqual([]);
    expect(ongoingSpellsOn(later, ALLY).map((o) => o.castingId)).toEqual([]);
    expect(derivedOn(later, later.ongoing[castingId]!)).toEqual([]);

    // And the casting is still running for anyone else — a deadline on one
    // grant is not the spell ending, which is the whole difference between a
    // `grants` timer and a `casting` one.
    expect(later.ongoing[castingId]).toBeDefined();
  });

  /**
   * **And the same thing in the branch the fixture above cannot reach**, which
   * is what makes the stored half a *subset* rather than the cast-time list.
   *
   * SRD Divine Favor is Range: Self — "Duration: 1 minute", no Concentration —
   * so the record's caster branch writes it, and the branch had a choice: the
   * caster always, or the caster only when the casting is holding nothing on
   * them. Divine Favor holds plenty: its `attack-rider` is a grant on the
   * caster, so the world answers for them and the cast has nothing to add.
   *
   * Writing the caster anyway would be harmless while the grant lasts and
   * wrong the moment it does not — the same stale name the `grants` deadline
   * above produced, in the one branch that deadline cannot be aimed at. So the
   * rule is one rule for all three branches: **store what is on minus what is
   * held**, and nothing that the world will answer for.
   *
   * Latent in exactly the same way and for exactly the same reason: the only
   * definition that writes a `grants` deadline is Ray of Frost, a cantrip with
   * no record at all, so the `effect-scheduled` here is written by hand.
   */
  it('a Range: Self casting stores nobody when it is holding something on its caster', () => {
    const cast = must(
      resolveSpell(base(), CASTER, { spellId: 'divine-favor', targets: [CASTER] }, supply()),
    );
    const during = applyAll(base(), cast.events);
    const castingId = cast.castingId!;

    // On its caster, and by the derived half alone: the record stores nobody.
    expect(during.ongoing[castingId]?.aimed).toEqual([]);
    expect(spellOn(during, during.ongoing[castingId]!)).toEqual([CASTER]);

    const source = during.creatures[CASTER]!.attackRiders[0]!.source;
    const scheduled = applyEvent(during, {
      type: 'effect-scheduled',
      target: { kind: 'grants', on: CASTER, source },
      deadline: { kind: 'elapsed', at: 6 },
    });
    const later = applyEvent(scheduled, { type: 'time-advanced', seconds: 6, reason: 'the round' });

    // The grant is gone, so the casting is on nobody — and it would still be
    // claiming its caster if the branch had written them down.
    expect(later.creatures[CASTER]?.attackRiders).toEqual([]);
    expect(spellOn(later, later.ongoing[castingId]!)).toEqual([]);
    expect(ongoingSpellsOn(later, CASTER)).toEqual([]);
  });
});
