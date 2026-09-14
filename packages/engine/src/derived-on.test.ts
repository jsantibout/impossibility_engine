import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { holdsNothingOf } from './fold/release.js';
import type { OngoingSpell } from './spells.js';
import { endOngoingSpell, ongoingSpellsOn, resolveSpell } from './commands.js';

/**
 * Whether `OngoingSpell.on` can be derived from the rule it obeys.
 *
 * The rule is one sentence and the whole engine already states it:
 *
 * > A casting is on a creature while it has a live effect there that the
 * > casting owns.
 *
 * `holdsNothingOf` computes exactly that, and `on` is nevertheless a **stored**
 * value kept in step by three passes — written at the cast, grown by `alsoOn`,
 * shrunk by `expireEffects`, edited by `withoutTarget`. A stored derivation
 * kept in step by hand is the shape this repository keeps finding wrong, and
 * CLAUDE.md records the bug this one already produced: a stale name let a
 * creature dispel a spell that was no longer on them.
 *
 * So this file is the **gate**: it measures whether the derivation reproduces
 * the stored value, before anything is removed. The measurement was also run
 * once in the strongest form available — the comparison wired into `applyEvent`
 * itself, so that every one of the suite's thousands of tests checked it after
 * every event — and what that found is pinned below as fixtures, because a
 * finding that lives only in a completion digest is a finding nobody meets
 * again.
 *
 * **The answer is that it cannot, and the two populations that say so are
 * named.** Both frozen logs agree with the derivation at every checkpoint; the
 * suite does not.
 */

const here = fileURLToPath(new URL('.', import.meta.url));

const read = (name: string): readonly GameEvent[] =>
  JSON.parse(readFileSync(`${here}../fixtures/${name}`, 'utf8')) as GameEvent[];

const GOLDEN_1: readonly GameEvent[] = read('golden-log.json');
const GOLDEN_2: readonly GameEvent[] = read('golden-log-2.json');

/**
 * What the rule says the casting is on, read live.
 *
 * The caster half is the one part of the record the rule cannot recover: SRD
 * Vampiric Touch is Range: Self and holds nothing on the wizard, so the
 * casting is on somebody it owns nothing of. That half is taken off the
 * stored value; everything else is asked of the world.
 *
 * It lives here rather than in the engine deliberately. The removal this
 * derivation was written for is blocked on what the measurement below found,
 * and a function in `src/` would be a mechanism committed ahead of the
 * decision that says which mechanism is wanted.
 */
const derivedOn = (state: GameState, record: OngoingSpell): readonly string[] =>
  [
    ...new Set<string>([
      ...record.on.filter(
        (who) => who === record.caster && state.creatures[who] !== undefined,
      ),
      ...Object.keys(state.creatures)
        .map((key) => state.creatures[key]!)
        .filter((creature) => !holdsNothingOf(state, creature.id, record.castingId))
        .map((creature) => creature.id),
    ]),
  ].sort();

/** Every disagreement between the stored value and the derivation, per event. */
interface Checked {
  readonly checkpoints: number;
  readonly mismatches: readonly string[];
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

  const compare = (at: number): void => {
    for (const [castingId, record] of Object.entries(state.ongoing)) {
      checkpoints += 1;
      const stored = [...record.on].sort().join(',');
      const derived = derivedOn(state, record).join(',');
      if (stored !== derived) {
        mismatches.push(`#${at} ${castingId} ${record.spellId} [${stored}] vs [${derived}]`);
      }
    }
  };

  compare(0);
  log.forEach((event, index) => {
    state = applyEvent(state, event);
    compare(index + 1);
  });

  return { checkpoints, mismatches };
}

describe('the frozen logs agree with the derivation at every event', () => {
  /**
   * 869 checkpoints, 0 mismatches — the measurement this task was briefed
   * from, reproduced.
   *
   * The floor is what makes it mean something: a fold that stopped producing
   * ongoing records would pass a mismatch count of zero while checking
   * nothing, which is the vacuity failure every sweep here is driven against.
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

const PREPARED = ['darkvision', 'bless', 'stoneskin'];

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
});

const applyAll = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce(applyEvent, state);

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
      resolveSpell(base(), CASTER, { spellId: 'darkvision', targets: [ALLY] }, supply()),
    );
    const after = applyAll(base(), cast.events);
    const record = after.ongoing[cast.castingId!]!;

    // The stored answer, and the one Dispel Magic reads.
    expect(record.on).toEqual([ALLY]);
    expect(ongoingSpellsOn(after, ALLY).map((o) => o.castingId)).toEqual([cast.castingId]);

    // The casting owns nothing on them, so the rule alone says nobody.
    expect(holdsNothingOf(after, ALLY, cast.castingId!)).toBe(true);
    expect(derivedOn(after, record)).toEqual([]);
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
  it('a released target is gone from the world and still in the cast-time list', () => {
    const cast = must(
      resolveSpell(base(), CASTER, { spellId: 'bless', targets: [ALLY, FOE], slotLevel: 1 }, supply()),
    );
    const during = applyAll(base(), cast.events);
    const castingId = cast.castingId!;
    expect(during.ongoing[castingId]?.on).toEqual([ALLY, FOE].sort());

    const released = applyAll(during, must(endOngoingSpell(during, CASTER, castingId, ALLY)));
    const record = released.ongoing[castingId]!;

    // Stored and derived agree, and the cast-time list does not.
    expect(record.on).toEqual([FOE]);
    expect(derivedOn(released, record)).toEqual([FOE]);
    expect(cast.events.flatMap((e) => (e.type === 'spell-ongoing' ? [...e.casting.on] : []))).toEqual(
      [ALLY, FOE].sort(),
    );
  });

  /**
   * **And the stored value is already stale in one place**, which is the same
   * bug CLAUDE.md says the shrink exists to prevent, still live for the fourth
   * `EffectTarget` member.
   *
   * `expireEffects` shrinks `on` in its **condition** branch and in no other,
   * so a `grants` deadline arriving takes the Resistance off the creature and
   * leaves the casting claiming to be on them. `holdsNothingOf` says otherwise
   * in the same breath, and `ongoingSpellsOn` reports a Stoneskin that a Dispel
   * Magic aimed at that fighter would then end.
   *
   * It is characterised rather than corrected: the correction is a change to
   * what the Dispel readers answer, and which mechanism should own that answer
   * is the question this file's measurement has opened. What is asserted is the
   * **disagreement** — two parts of the engine giving different answers to one
   * question — rather than either answer being right.
   *
   * **So whoever fixes `fold/expiry.ts` should expect this to go red**, and
   * that is the test doing its job rather than a regression: the two lines
   * below that read `on` and `ongoingSpellsOn` are the stale answer, and the
   * line that reads `derivedOn` is the one a fix would make true of all three.
   *
   * It is also **latent**. A `grants` timer has one runtime writer — the
   * `speed-change` rider's `lasts` — and Ray of Frost is the only definition
   * that writes one, a cantrip that leaves no ongoing record at all. So no
   * registered spell reaches this, which is why the `effect-scheduled` below
   * is written by hand.
   */
  it('a grants deadline leaves a name in the stored list the rule has dropped', () => {
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

    // The two answers disagree, which is the finding.
    expect(later.ongoing[castingId]?.on).toEqual([ALLY]);
    expect(ongoingSpellsOn(later, ALLY).map((o) => o.castingId)).toEqual([castingId]);
    expect(derivedOn(later, later.ongoing[castingId]!)).toEqual([]);
  });
});
