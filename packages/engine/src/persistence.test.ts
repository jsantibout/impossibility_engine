import { SRD_CONTENT } from '@ie/content';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fold, type GameEvent, type GameState } from './events.js';

/**
 * The contract a stored campaign relies on.
 *
 * From M3 the log *is* the database: Postgres holds the events and `GameState`
 * is what folding them produces. That makes the fold a compatibility surface,
 * and compatibility surfaces break quietly unless something is watching.
 *
 * **What the engine actually guarantees, stated exactly:** the same log, under
 * the same engine version, folds to the same state. That is what determinism
 * means here and it is thoroughly tested elsewhere.
 *
 * **What it does not guarantee** is that a log folds the same way under a
 * *later* engine version — and it cannot, because the fold is not pure replay.
 * Five derived passes run after every event: Concentration breaking, features
 * losing their conditions, effects expiring, readied actions lapsing, orphaned
 * saves dropping. Those are rules, deliberately, because nobody decides that a
 * stunned wizard's spell ends. Change one and every stored campaign folds
 * differently the next time it is opened.
 *
 * That is a real trade and the right one — the alternative is a dead wizard's
 * Hold Person still running because the log happened to be assembled before
 * the fix. But it means a rules change can be a **migration** rather than a
 * patch, and something has to say so.
 *
 * `fixtures/golden-log.json` is a log written by the engine as it stood and
 * then frozen: 93 events across 35 types, a five-round fight left **saved
 * mid-encounter**, because a log that ended tidily folds to an empty derived
 * state and an empty derived state is the same under every expiry rule there
 * has ever been.
 *
 * **What this adds over the rest of the suite, stated honestly.** Most rules
 * changes fail a unit test first, and more informatively — moving an expiry
 * boundary by one breaks a dozen tests in `duration.test.ts` before it reaches
 * here. What a unit test cannot see is the shape of the *log*: a renamed or
 * retired event, a field that changed meaning, a composition that only appears
 * across a whole campaign. Those are invisible at compile time to a log
 * written last season and are exactly what breaks on a deploy.
 *
 * So when this file fails it is asking one question — *is this a migration?* —
 * and there are two honest answers: fix the regression, or change the
 * expectations in the same commit that changes the rule, saying which stored
 * campaigns move.
 *
 * **Do not regenerate the fixture to make this pass.** The generator lives at
 * `scripts/make-golden-log.ts` and exists to document how the log was built,
 * not to refresh it — a regenerated golden log is a golden log that has
 * stopped testing anything. Adding a *second* fixture beside it is the right
 * move when the vocabulary grows.
 */

const here = fileURLToPath(new URL('.', import.meta.url));

const GOLDEN: readonly GameEvent[] = JSON.parse(
  readFileSync(`${here}../fixtures/golden-log.json`, 'utf8'),
) as GameEvent[];

/** Round-trip through the shape Postgres would store and hand back. */
const throughJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('a stored log still folds', () => {
  it('folds at all', () => {
    expect(() => fold('golden', GOLDEN, SRD_CONTENT)).not.toThrow();
  });

  it('is worth folding: it exercises a real campaign, not a stub', () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(70);
    expect(new Set(GOLDEN.map((e) => e.type)).size).toBeGreaterThanOrEqual(30);
  });

  /**
   * The authoritative facts, named one at a time rather than snapshotted as a
   * blob. A blob fails informatively only to whoever wrote it; these say which
   * rule moved.
   */
  it('folds to the state it has always folded to', () => {
    const state = fold('golden', GOLDEN, SRD_CONTENT);

    // The clock, which combat derives and narration advances.
    expect(state.elapsed).toBe(624);
    expect(state.combat?.round).toBe(5);

    // Hit points, through damage, a spell, and a Concentration save.
    expect(state.creatures.cleric?.vitals.hp).toBe(28);
    expect(state.creatures.rat?.vitals.hp).toBe(3);
    expect(state.creatures.thug?.vitals.hp).toBe(32);

    // Resources, spent and stayed spent.
    expect(state.creatures.cleric?.resources.pools['spell-slot:1']?.spent).toBe(1);
    expect(state.creatures.cleric?.resources.pools['spell-slot:2']?.spent).toBe(2);

    // Castings are sequential and their ids are load-bearing for every effect
    // linked to them, so the count is part of the contract.
    expect(state.castingsBegun).toBe(4);

    // Idempotency keys survive a reload, or a retry after a restart would be a
    // second casting.
    expect(Object.keys(state.appliedCommands)).toHaveLength(28);

    // Equipment, and the sheet view derived from it.
    expect(state.creatures.cleric?.equipped.map((held) => held.id)).toContain('chain-shirt');
    expect(state.creatures.cleric?.sheet.armor).not.toBeNull();
  });

  /**
   * The derived passes, which are the half a later engine version can move
   * without anybody noticing. The fixture stops mid-fight for exactly this:
   * an empty derived state folds the same way under every expiry rule there
   * has ever been, so a log that ended tidily would have tested nothing here.
   */
  it('folds the derived rules to what they have always derived', () => {
    const state = fold('golden', GOLDEN, SRD_CONTENT);

    // A Concentration still held, and the condition it is holding up.
    expect(state.creatures.cleric?.concentration?.spell).toBe('Hold Person');
    expect(state.creatures.thug?.conditions.conditions).toEqual(['incapacitated', 'paralyzed']);

    // A benefit on a turn-anchored deadline, still inside it.
    expect(state.creatures.rat?.activeFeatures).toEqual(['action:dodge']);

    // Three deadlines still waiting: the casting, the condition it placed, and
    // the Dodge. Expiry is derived, so a change to when any of them fires
    // changes this number without changing a single event.
    expect(Object.keys(state.timers)).toHaveLength(3);
    expect(Object.keys(state.pendingSaves)).toHaveLength(0);
  });

  it('folds the same way twice', () => {
    expect(fold('golden', GOLDEN, SRD_CONTENT)).toStrictEqual(fold('golden', GOLDEN, SRD_CONTENT));
  });

  /**
   * The seed is recorded so a *live* session resumes its generator, never so a
   * replay can roll again — every outcome is already written down. A campaign
   * reopened under a different seed is the same campaign.
   */
  it('folds the same way under a different seed', () => {
    expect(fold('somebody-elses-seed', GOLDEN, SRD_CONTENT)).toStrictEqual({
      ...fold('golden', GOLDEN, SRD_CONTENT),
      seed: 'somebody-elses-seed',
    });
  });
});

describe('the log survives the database', () => {
  /**
   * Events go to Postgres as JSONB and come back parsed. Anything JSON cannot
   * carry is silently lost on the way — and `toEqual` would not notice, because
   * it treats a missing key and an `undefined` one as the same. `toStrictEqual`
   * is the point of these two.
   */
  it('folds identically after a round trip through JSON', () => {
    expect(fold('golden', throughJson(GOLDEN), SRD_CONTENT)).toStrictEqual(fold('golden', GOLDEN, SRD_CONTENT));
  });

  it('produces a state that is itself JSON, exactly', () => {
    const state: GameState = fold('golden', GOLDEN, SRD_CONTENT);
    expect(throughJson(state)).toStrictEqual(state);
  });

  /** And at every prefix, so a partially-written log is not a special case. */
  it('round-trips at every prefix of the log', () => {
    for (let n = 0; n <= GOLDEN.length; n += 1) {
      const prefix = GOLDEN.slice(0, n);
      expect(fold('golden', throughJson(prefix), SRD_CONTENT)).toStrictEqual(fold('golden', prefix, SRD_CONTENT));
    }
  });
});

/**
 * Every event type the reducer knows, read out of the union it is declared in.
 *
 * A rename or a retirement is invisible at compile time to a log written last
 * season — the reducer now refuses an event it has no rule for, loudly, which
 * turns the failure into a stuck campaign rather than a silent one. This turns
 * it into a failing test *before* the deploy instead.
 */
function declaredEventTypes(): readonly string[] {
  const source = readFileSync(`${here}events.ts`, 'utf8');
  const found = [...source.matchAll(/readonly type: '([a-z-]+)'/g)].map((m) => m[1]!);
  return [...new Set(found)].sort();
}

/**
 * The vocabulary as it stands. **Appending is free; renaming and removing are
 * migrations**, and editing this list is how you say you meant to.
 */
const KNOWN_EVENT_TYPES: readonly string[] = [
  'action-rule-granted',
  'action-spent',
  'area-effect-settled',
  'armor-class-granted',
  'attack-damage-dealt',
  'attack-landed',
  'attack-made',
  'attack-rider-granted',
  'attuned',
  'attunement-ended',
  'benefit-denied',
  'bonus-action-spent',
  'bonus-applied',
  'bonus-removed',
  'budget-compelled',
  'casting-continued',
  'casting-save-recorded',
  'character-advanced',
  'character-created',
  'coins-changed',
  'combat-ended',
  'combat-started',
  'combatant-joined',
  'combatant-removed',
  'concentration-ended',
  'concentration-started',
  'condition-applied',
  'condition-immunity-granted',
  'condition-removed',
  'cover-declared',
  'creature-added',
  'creature-attached',
  'creature-detached',
  'creature-died',
  'creature-heads-declared',
  'creature-lifted',
  'creature-moved',
  'creature-placed',
  'creature-removed',
  'creature-revived',
  'creature-side-declared',
  'creature-summoned',
  'creature-type-declared',
  'creature-type-masked',
  'creature-unplaced',
  'creature-woken',
  'damage-defense-granted',
  'damage-dice-recorded',
  'damage-penalty-granted',
  'damage-reaction-answered',
  'damage-reduction-granted',
  'damage-rolled',
  'damage-scheduled',
  'damage-settled',
  'damage-taken',
  'damage-type-declared',
  'dash-taken',
  'death-save-recorded',
  'decoy-destroyed',
  'difficult-terrain-declared',
  'disengage-taken',
  'dismounted',
  'effect-check-resolved',
  'effect-save-resolved',
  'effect-scheduled',
  'exhaustion-set',
  'fall-declared',
  'fall-ward-granted',
  'feature-activated',
  'feature-ended',
  'feature-used',
  'free-interaction-used',
  'hazard-caught',
  'hazard-ended',
  'healed',
  'healing-rule-granted',
  'help-given',
  'hit-point-maximum-adjusted',
  'hit-point-maximum-raised',
  'hit-point-maximum-restored',
  'hit-points-dropped-to-zero',
  'initiative-swapped',
  'item-dropped',
  'item-equipped',
  'item-taken-up',
  'item-transferred',
  'item-unequipped',
  'items-gained',
  'items-lost',
  'jump-allowance-granted',
  'jump-allowance-spent',
  'landmark-added',
  'light-declared',
  'mounted',
  'movement-completed',
  'movement-declared',
  'movement-granted',
  'movement-spent',
  'obscurement-declared',
  'opportunity-answered',
  'passive-defense-granted',
  'printed-line-expended',
  'printed-line-immunity-granted',
  'printed-line-recharged',
  'reaction-grant-consumed',
  'reaction-granted',
  'reaction-spent',
  'reaction-taken',
  'readied-declared',
  'readied-released',
  'resource-pool-declared',
  'resource-pool-recovery-changed',
  'resource-pool-resized',
  'resource-regained',
  'resource-spent',
  'resources-restored',
  'rest-begun',
  'rest-ended',
  'roll-modifier-consumed',
  'roll-modifier-granted',
  'roll-recorded',
  'rolls-issued',
  'scene-set',
  'scheduled-damage-collected',
  'sense-granted',
  'shape-assumed',
  'sight-declared',
  'speed-modifier-granted',
  'spell-activated',
  'spell-aim-changed',
  'spell-cast',
  'spell-declared',
  'spell-ended',
  'spell-interrupted',
  'spell-ongoing',
  'spell-origin-moved',
  'spellcasting-declared',
  'stabilised',
  'stated-action-taken',
  'stated-bonus-action-taken',
  'temporary-hp-cleared',
  'temporary-hp-granted',
  'test-reaction-answered',
  'test-rolled',
  'test-settled',
  'time-advanced',
  'turn-advanced',
  'turn-budget-granted',
  'turn-payout-granted',
  'unarmed-strike-made',
  'utilize-taken',
  'weapon-rider-granted',
];

describe('the event vocabulary is a contract', () => {
  it('has not lost or renamed a type without saying so', () => {
    const declared = declaredEventTypes();
    const missing = KNOWN_EVENT_TYPES.filter((t) => !declared.includes(t));
    expect(missing).toEqual([]);
  });

  /**
   * Additions are free and this test says so out loud: a new type shows up
   * here as a diff to acknowledge, not as a failure to work around.
   */
  it('lists every type the reducer declares', () => {
    const declared = declaredEventTypes();
    const added = declared.filter((t) => !KNOWN_EVENT_TYPES.includes(t));
    expect(added).toEqual([]);
  });

  /**
   * And in an order two branches can both append to.
   *
   * The list above is a migration ledger, and the two tests either side of this
   * one compare *sets* — so nothing currently notices if a merge reshuffles it.
   * Sorted, two people each adding an event append in different places instead
   * of fighting over the same line.
   */
  it('is sorted, so appending is a one-line diff', () => {
    expect(KNOWN_EVENT_TYPES).toEqual([...KNOWN_EVENT_TYPES].sort());
  });

  it('can still fold every type the golden log actually uses', () => {
    const used = [...new Set(GOLDEN.map((e) => e.type))].sort();
    expect(used.filter((t) => !declaredEventTypes().includes(t))).toEqual([]);
  });
});
