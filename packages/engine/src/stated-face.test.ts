import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isErr, expect as expectOk, type Result } from '@ie/shared';
import type { Rng, RngState } from './dice.js';
import { createRng } from './dice.js';
import type { AbilityScores, CharacterSheet } from './character.js';
import { rollAbilityCheck, rollSavingThrow } from './checks.js';
import { rollAttack } from './attack.js';
import { createRollIssuer } from './rolls.js';

/**
 * A die somebody else threw.
 *
 * The owner ruled on 2026-09-21 that a physical table is a first-class caller:
 * people like to roll their own dice, and the DM often does too. These are the
 * engine's two d20 sites accepting a face that was thrown on a table — and
 * nothing else. The modifier, the mode, every named contribution, which face
 * counts and what the outcome was all stay the engine's.
 */

const scores = (over: Partial<AbilityScores> = {}): AbilityScores => ({
  str: 10,
  dex: 10,
  con: 10,
  int: 10,
  wis: 10,
  cha: 10,
  ...over,
});

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 1,
  abilities: scores(),
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  ...over,
});

/**
 * A generator that fails the test if anything asks it for a number.
 *
 * The point of a stated face is that the engine throws nothing, so "the
 * generator did not move" is stronger stated as "the generator was never
 * touched" than as a snapshot comparison.
 */
const untouchable = (): Rng => ({
  int: () => {
    throw new Error('the generator was asked for a die on a roll the table threw');
  },
  snapshot: (): RngState => [0, 0, 0, 0],
});

/** `expect` from `@ie/shared`, with the one context string this whole file shares. */
const unwrap = <T>(result: Result<T>): T => expectOk(result, 'a roll this test made');

const code = (result: Result<unknown>): string => (isErr(result) ? result.code : 'not-a-refusal');

const kind = (result: Result<unknown>): string => (isErr(result) ? result.kind : 'not-a-refusal');

describe('a stated face at the attack roll', () => {
  it("is the die, and the modifier and the mode are still the engine's", () => {
    const issuer = createRollIssuer('r');
    const attack = unwrap(
      rollAttack(issuer, untouchable(), sheet(), {
        weapon: null,
        targetAc: 10,
        // Advantage and Disadvantage cancel — the engine's rule, applied to a
        // roll the engine did not throw.
        modes: ['advantage', 'disadvantage'],
        statedRoll: { faces: [17], source: 'physical-dice' },
      }),
    );

    expect(attack.roll.natural).toBe(17);
    expect(attack.roll.rolls).toEqual([17]);
    expect(attack.roll.provenance.source).toBe('physical-dice');
    expect(attack.mode).toBe('normal');
    // Unarmed Strike, proficient, Strength 10: the +2 is the engine's arithmetic.
    expect(attack.roll.modifier).toBe(2);
    expect(attack.total).toBe(19);
    expect(attack.hit).toBe(true);
    expect(issuer.count).toBe(1);
  });

  it('carries a note, and says who threw it', () => {
    const issuer = createRollIssuer('r');
    const attack = unwrap(
      rollAttack(issuer, untouchable(), sheet(), {
        weapon: null,
        targetAc: 10,
        statedRoll: { faces: [12], source: 'physical-dice', note: 'rolled off the table, re-thrown' },
      }),
    );

    expect(attack.roll.provenance.note).toBe('rolled off the table, re-thrown');
  });

  it('crits on a stated 20 and misses on a stated 1, by the rules an engine die obeys', () => {
    const critical = unwrap(
      rollAttack(createRollIssuer('r'), untouchable(), sheet(), {
        weapon: null,
        // An AC nothing could reach: a natural 20 hits regardless.
        targetAc: 99,
        statedRoll: { faces: [20], source: 'physical-dice' },
      }),
    );
    expect(critical.critical).toBe(true);
    expect(critical.hit).toBe(true);

    const fumble = unwrap(
      rollAttack(createRollIssuer('r'), untouchable(), sheet(), {
        weapon: null,
        // An AC anything would beat: a natural 1 misses regardless.
        targetAc: 1,
        statedRoll: { faces: [1], source: 'physical-dice' },
      }),
    );
    expect(fumble.hit).toBe(false);
    expect(fumble.critical).toBe(false);
  });

  it('honours a feature that lowers the critical face, on a face the table threw', () => {
    const champion = unwrap(
      rollAttack(createRollIssuer('r'), untouchable(), sheet(), {
        weapon: null,
        targetAc: 99,
        criticalOn: 19,
        statedRoll: { faces: [19], source: 'physical-dice' },
      }),
    );
    expect(champion.critical).toBe(true);
    expect(champion.hit).toBe(true);
  });
});

describe('a stated face at the check and save', () => {
  it("is the die, and the DC comparison is still the engine's", () => {
    const issuer = createRollIssuer('r');
    const check = unwrap(
      rollAbilityCheck(issuer, untouchable(), sheet({ abilities: scores({ dex: 16 }) }), 'dex', {
        dc: 15,
        statedRoll: { faces: [12], source: 'physical-dice' },
      }),
    );

    expect(check.natural).toBe(12);
    expect(check.modifier).toBe(3);
    expect(check.total).toBe(15);
    expect(check.success).toBe(true);
    expect(check.roll.provenance.source).toBe('physical-dice');
    expect(issuer.count).toBe(1);
  });

  it("takes a DM's stated ruling as its own kind of external roll", () => {
    const save = unwrap(
      rollSavingThrow(createRollIssuer('r'), untouchable(), sheet(), 'wis', {
        dc: 10,
        statedRoll: { faces: [9], source: 'dm-override', note: 'the die was cocked' },
      }),
    );

    expect(save.natural).toBe(9);
    expect(save.success).toBe(false);
    expect(save.roll.provenance.source).toBe('dm-override');
  });
});

describe('what the engine refuses, and what it costs', () => {
  it('refuses a face a d20 cannot show, and consumes no roll id', () => {
    const issuer = createRollIssuer('r');
    const refused = rollAttack(issuer, untouchable(), sheet(), {
      weapon: null,
      targetAc: 10,
      statedRoll: { faces: [25], source: 'physical-dice' },
    });

    expect(code(refused)).toBe('impossible_die');
    expect(issuer.count).toBe(0);
  });

  it('refuses one on the check path too, and consumes no roll id', () => {
    const issuer = createRollIssuer('r');
    const refused = rollAbilityCheck(issuer, untouchable(), sheet(), 'dex', {
      dc: 10,
      statedRoll: { faces: [0], source: 'physical-dice' },
    });

    expect(code(refused)).toBe('impossible_die');
    expect(issuer.count).toBe(0);
  });

  it('refuses a caller claiming the engine threw it', () => {
    const issuer = createRollIssuer('r');
    const forged = rollAttack(issuer, untouchable(), sheet(), {
      weapon: null,
      targetAc: 10,
      statedRoll: { faces: [17], source: 'engine' },
    });

    expect(code(forged)).toBe('forged_provenance');
    expect(issuer.count).toBe(0);

    const forgedCheck = rollAbilityCheck(issuer, untouchable(), sheet(), 'dex', {
      dc: 10,
      statedRoll: { faces: [17], source: 'engine' },
    });
    expect(code(forgedCheck)).toBe('forged_provenance');
    expect(issuer.count).toBe(0);
  });

  it('calls a forgery a forgery even where it states no face at all', () => {
    // The claim is wrong, not missing, and answering it with `needs-context`
    // would invite a retry of a call the engine refuses however many faces it
    // arrives with.
    const issuer = createRollIssuer('r');
    const forged = rollAbilityCheck(issuer, untouchable(), sheet(), 'dex', {
      dc: 10,
      statedRoll: { faces: [], source: 'engine' },
    });

    expect(kind(forged)).toBe('refusal');
    expect(code(forged)).toBe('forged_provenance');
    expect(issuer.count).toBe(0);
  });

  it('refuses an impossible face even where the other one is fine', () => {
    const issuer = createRollIssuer('r');
    const refused = rollAttack(issuer, untouchable(), sheet(), {
      weapon: null,
      targetAc: 10,
      modes: ['advantage'],
      statedRoll: { faces: [17, 21], source: 'physical-dice' },
    });

    expect(code(refused)).toBe('impossible_die');
    expect(issuer.count).toBe(0);
  });
});

/**
 * **The design question, and the answer.** A table rolling with Advantage
 * throws two physical dice, and the engine's `mode` machinery expects to throw
 * them itself.
 *
 * The ruling: **the table states every face it threw and the engine decides
 * which one counts.** The alternative — one stated face, meaning "the die that
 * counted" — hands the table the one part of this that is genuinely the
 * engine's. Whether a roll has Advantage at all is not something the table can
 * know before it rolls: Advantage and Disadvantage *cancel*, and they are
 * gathered from the sheet, the creature's conditions, its standing effects and
 * the granted modifiers on it as well as from what the caller supplied. A table
 * that believed it had Advantage, threw two dice and read out the higher one
 * would be silently overriding a cancellation the engine had just computed —
 * and nothing in the log would show it. So the count of faces follows the mode
 * the engine computed: one for a normal roll, two for Advantage or
 * Disadvantage, and highest or lowest is applied here as it always was.
 *
 * A face short is `needs-context` and not a refusal, because it is the thin
 * record rather than a verdict: nothing was spent, no die was thrown, and the
 * same call with the second face filled in is the call the caller meant. A face
 * too many is a refusal, because the fact is wrong rather than missing and
 * quietly discarding one of two physical dice would be the engine choosing
 * which one the table threw.
 */
describe('Advantage and Disadvantage with a stated face', () => {
  it('takes the higher of two stated faces under Advantage, and records both', () => {
    const issuer = createRollIssuer('r');
    const attack = unwrap(
      rollAttack(issuer, untouchable(), sheet(), {
        weapon: null,
        targetAc: 10,
        modes: ['advantage'],
        statedRoll: { faces: [6, 18], source: 'physical-dice' },
      }),
    );

    expect(attack.mode).toBe('advantage');
    expect(attack.roll.natural).toBe(18);
    expect(attack.roll.rolls).toEqual([6, 18]);
    expect(attack.total).toBe(20);
    expect(issuer.count).toBe(1);
  });

  it('takes the lower under Disadvantage', () => {
    const check = unwrap(
      rollAbilityCheck(createRollIssuer('r'), untouchable(), sheet(), 'dex', {
        dc: 10,
        modes: ['disadvantage'],
        statedRoll: { faces: [6, 18], source: 'physical-dice' },
      }),
    );

    expect(check.mode).toBe('disadvantage');
    expect(check.natural).toBe(6);
    expect(check.rolls).toEqual([6, 18]);
  });

  it('asks for the second face rather than refusing, and spends nothing asking', () => {
    const issuer = createRollIssuer('r');
    const asked = rollAttack(issuer, untouchable(), sheet(), {
      weapon: null,
      targetAc: 10,
      modes: ['advantage'],
      statedRoll: { faces: [11], source: 'physical-dice' },
    });

    expect(kind(asked)).toBe('needs-context');
    expect(code(asked)).toBe('stated_faces_missing');
    expect(isErr(asked) ? asked.reason : '').toContain('Advantage');
    expect(issuer.count).toBe(0);
  });

  it('refuses a second face on a roll the engine made normal', () => {
    const issuer = createRollIssuer('r');
    // The table believed it had Advantage. The engine holds a Disadvantage it
    // did not know about, the two cancel, and one of those two dice would have
    // to be thrown away by somebody. Not by the engine.
    const refused = rollAbilityCheck(issuer, untouchable(), sheet(), 'dex', {
      dc: 10,
      modes: ['advantage', 'disadvantage'],
      statedRoll: { faces: [6, 18], source: 'physical-dice' },
    });

    expect(kind(refused)).toBe('refusal');
    expect(code(refused)).toBe('stated_faces_surplus');
    expect(issuer.count).toBe(0);
  });

  it('asks when the table states no face at all', () => {
    const issuer = createRollIssuer('r');
    const asked = rollAbilityCheck(issuer, untouchable(), sheet(), 'dex', {
      dc: 10,
      statedRoll: { faces: [], source: 'physical-dice' },
    });

    expect(kind(asked)).toBe('needs-context');
    expect(issuer.count).toBe(0);
  });
});

/**
 * **The determinism criterion.** An external roll consumes a roll id without
 * advancing the generator: `rolls-issued {count, rng}` carries an unchanged
 * snapshot, the fold advances the id counter and copies the snapshot, and the
 * next engine die is exactly the die it would have been had the table roll
 * never happened.
 */
describe('a table roll costs an id and not a die', () => {
  const run = (table: boolean) => {
    const rng = createRng('x3-stated-face');
    const issuer = createRollIssuer('r');

    const first = unwrap(rollAbilityCheck(issuer, rng, sheet(), 'dex', { dc: 10 }));
    if (table) {
      unwrap(
        rollAbilityCheck(issuer, rng, sheet(), 'dex', {
          dc: 10,
          statedRoll: { faces: [13], source: 'physical-dice' },
        }),
      );
    }
    const second = unwrap(rollAbilityCheck(issuer, rng, sheet(), 'dex', { dc: 10 }));

    return { first, second, ids: issuer.count, rng: rng.snapshot() };
  };

  it('leaves the next engine die exactly the die it would have been', () => {
    const withTable = run(true);
    const without = run(false);

    expect(withTable.first.natural).toBe(without.first.natural);
    expect(withTable.second.natural).toBe(without.second.natural);
    expect(withTable.second.rolls).toEqual(without.second.rolls);
    expect(withTable.second.total).toBe(without.second.total);
    expect(withTable.rng).toEqual(without.rng);
  });

  it('consumes the id, which is the whole of what it costs', () => {
    const withTable = run(true);
    const without = run(false);

    expect(withTable.ids).toBe(without.ids + 1);
    expect(without.second.roll.provenance.id).toBe('r:2');
    expect(withTable.second.roll.provenance.id).toBe('r:3');
  });

  it('and a refused face costs not even that', () => {
    const rng = createRng('x3-stated-face');
    const issuer = createRollIssuer('r');
    const before = rng.snapshot();

    const refused = rollAbilityCheck(issuer, rng, sheet(), 'dex', {
      dc: 10,
      statedRoll: { faces: [21], source: 'physical-dice' },
    });

    expect(isErr(refused)).toBe(true);
    expect(issuer.count).toBe(0);
    expect(rng.snapshot()).toEqual(before);

    const next = unwrap(rollAbilityCheck(issuer, rng, sheet(), 'dex', { dc: 10 }));
    expect(next.roll.provenance.id).toBe('r:1');
  });
});

/**
 * **The boundary, and exactly how much of it this file keeps.**
 *
 * The seam is on the engine's roll functions and on nothing a command builds.
 * The sweep below proves one thing and only that thing: no command module names
 * the field, the type or the function. The other half — that every command
 * assembles its options field by field rather than spreading what a caller
 * handed it, so a field nobody names cannot arrive anyway — was read rather
 * than swept, at every call site that rolls.
 *
 * **The gap it does not close, reported rather than dug.** `resolveStatedD20`
 * and the two roll functions are on `@ie/engine`'s public surface, and neither
 * `boundary.test.ts` nor `dm/boundary.test.ts` in `@ie/tools` lists them among
 * the names it may not import — so a tools file *written to* could reach a
 * stated face without either name sweep going red. Nothing it produced could
 * reach the event log, because the log is written from a command's own events
 * and no command carries the field. The fix belongs to whoever owns
 * `packages/tools` next, exactly as `dm/boundary.test.ts` records the same
 * hazard for `rollAttackDamage`: add `resolveStatedD20` to both `FORBIDDEN`
 * lists when the command surface and the table's door are built.
 */
describe('no command reaches the seam', () => {
  const COMMANDS = fileURLToPath(new URL('./commands/', import.meta.url));

  it('names it in no command module', () => {
    const breaches: string[] = [];
    for (const file of readdirSync(COMMANDS)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
      const text = readFileSync(COMMANDS + file, 'utf8');
      if (/\bstatedRoll\b|\bStatedD20\b|\bresolveStatedD20\b/.test(text)) {
        breaches.push(`commands/${file} reaches a stated face`);
      }
    }
    expect(breaches).toEqual([]);
  });

  it('sweeps something: the command modules are there and do drive the rolls', () => {
    const files = readdirSync(COMMANDS).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files).toContain('attacks.ts');
    expect(readFileSync(COMMANDS + 'attacks.ts', 'utf8')).toContain('rollAttack');
  });
});
