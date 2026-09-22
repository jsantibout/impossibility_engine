import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  contextRequestsOf,
  isErr,
  isNeedsContext,
  expect as unwrap,
  type CharacterId,
} from '@ie/shared';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer, type RollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import {
  beginCombat,
  recordInitiativeRolls,
  rollInitiativeAndBeginCombat,
  rollInitiativeFor,
} from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { speedOf } from './standing.js';

/**
 * Beginning a fight without writing an event by hand.
 *
 * `rollInitiativeFor` handed back a number and nothing else, so **every**
 * caller that wanted a log wrote the `rolls-issued` event itself to record
 * that the generator had moved: the scripted scenario, the probe's harness and
 * the probe's parity mill. That is the one place the rule the probe's own
 * session module states — "there is deliberately no way to append an event a
 * command did not produce" — was broken, and it was broken by the engine
 * leaving no other way to be correct.
 *
 * A caller that forgets the event does not get an error. It gets a fight whose
 * Initiative dice are rolled again by the next thing that rolls, which is the
 * quiet kind of wrong this repository exists to make loud.
 *
 * Four claims, in the order they matter:
 *
 * 1. the new path folds to the state the hand-assembled one folds to, so it is
 *    the same fight and not a new one;
 * 2. the generator's position in state is where the dice actually got to;
 * 3. the log replays byte-identically from its seed — the property
 *    `scenario.test.ts` holds for a scripted fight, asserted here for this
 *    path directly;
 * 4. and no caller writes the event any more, read off the source rather than
 *    promised.
 */

const id = (s: string) => asCharacterId(s);
const BREN = id('bren');
const ROWAN = id('rowan');
const SEED = 'a-fight';

/** A level 1 Fighter with the Alert feat, so a feature rides on the roll. */
const walkOn = (name: string): CharacterChoices => ({
  name,
  classId: 'fighter',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'], 'fighter:weapon-mastery': [] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'archery' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

/** Two creatures on the board, by command. */
const CAST: readonly GameEvent[] = [
  ...unwrap(createCharacter(SRD_CONTENT, walkOn('Bren'), BREN), 'bren'),
  ...unwrap(createCharacter(SRD_CONTENT, walkOn('Rowan'), ROWAN), 'rowan'),
];

/**
 * A generator and an issuer resumed from exactly where the log says, which is
 * what a live session does between calls.
 */
const supplyFrom = (
  log: readonly GameEvent[],
): { readonly issuer: RollIssuer; readonly rng: Rng; readonly content: typeof SRD_CONTENT } => {
  const now = fold(SEED, log);
  return {
    issuer: createRollIssuer('r', now.rollsIssued),
    rng: now.rng === null ? createRng(SEED) : restoreRng(now.rng),
    content: SRD_CONTENT,
  };
};

const entrants = [
  { id: BREN, speed: 30 },
  { id: ROWAN, speed: 30 },
];

/** Exactly what every caller does today: roll, then write the event yourself. */
function byHand(): readonly GameEvent[] {
  const log: GameEvent[] = [...CAST];
  const { issuer, rng } = supplyFrom(log);
  const before = issuer.count;
  const combatants = entrants.map((entrant) => ({
    ...entrant,
    initiative: unwrap(rollInitiativeFor(fold(SEED, log), entrant.id, issuer, rng), 'initiative')
      .total,
  }));
  log.push({ type: 'rolls-issued', count: issuer.count - before, rng: rng.snapshot() });
  log.push(...unwrap(beginCombat(fold(SEED, log), combatants), 'begin'));
  return log;
}

/** The same fight, through the one command that emits everything it causes. */
function byCommand(commandId?: string): readonly GameEvent[] {
  const started = unwrap(
    rollInitiativeAndBeginCombat(
      fold(SEED, CAST),
      entrants,
      supplyFrom(CAST),
      commandId === undefined ? {} : { commandId },
    ),
    'fight',
  );
  return [...CAST, ...started];
}

describe('a fight begins through one command, and that command writes every event it causes', () => {
  it('folds to the state the hand-assembled log folds to', () => {
    const commanded = fold(SEED, byCommand());
    const handmade = fold(SEED, byHand());

    // Every region of the world is identical — the same order, the same
    // totals, the same generator. The one field that differs is `eventCount`,
    // which counts the log rather than the world: the new path additionally
    // says *what each creature rolled*, and a `roll-recorded` changes no state
    // by design.
    expect({ ...commanded, eventCount: 0 }).toEqual({ ...handmade, eventCount: 0 });
    expect(commanded.eventCount - handmade.eventCount).toBe(
      byCommand().filter((event) => event.type === 'roll-recorded').length,
    );
  });

  it('carries the generator forward, which is the event the caller used to write', () => {
    const state = fold(SEED, byCommand());

    // The dice actually thrown, replayed outside the command: the same two
    // rolls off the same resumed generator land the generator in the same
    // place, and state says so.
    const { issuer, rng } = supplyFrom(CAST);
    for (const entrant of entrants) {
      unwrap(rollInitiativeFor(fold(SEED, CAST), entrant.id, issuer, rng), 'initiative');
    }
    expect(state.rollsIssued).toBe(issuer.count);
    expect(state.rng).toEqual(rng.snapshot());

    // And the hole this closes: a log without the event resumes the generator
    // where the fight started, so the next thing to roll throws the Initiative
    // dice again.
    const forgetful = byCommand().filter((event) => event.type !== 'rolls-issued');
    expect(fold(SEED, forgetful).rng).not.toEqual(state.rng);
  });

  it('emits the event itself rather than leaving it to the caller', () => {
    const emitted = byCommand().slice(CAST.length);
    expect(emitted.map((event) => event.type)).toContain('rolls-issued');
    expect(emitted.map((event) => event.type)).toContain('combat-started');
  });

  it('replays byte-identically from its seed', () => {
    const log = byCommand();

    // A log that has been through a file, which is what a resumed campaign
    // actually folds, against the state the live one folded to — serialised,
    // because "byte-identical" is a claim about the bytes and `toEqual` would
    // settle for structurally equal.
    const reloaded = JSON.parse(JSON.stringify(log)) as GameEvent[];
    expect(JSON.stringify(fold(SEED, reloaded))).toEqual(JSON.stringify(fold(SEED, log)));

    // And the command run again from the same seed writes the same log, so the
    // fight is replayed rather than re-rolled.
    expect(byCommand()).toEqual(log);
    expect(JSON.stringify(fold(SEED, byCommand()))).toEqual(JSON.stringify(fold(SEED, log)));
  });

  it('ranks by what the dice said, and pins the Speed it was given', () => {
    const combat = fold(SEED, byCommand()).combat!;
    const totals = combat.order.map((c) => c.initiative);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
    expect(combat.order.map((c) => c.id).sort()).toEqual([BREN, ROWAN].sort());
    expect(combat.round).toBe(1);
    expect(speedOf(fold(SEED, byCommand()), BREN)).toBe(30);
  });

  it('answers a retry under one id with nothing, having rolled once', () => {
    const first = byCommand('one-fight');
    const again = unwrap(
      rollInitiativeAndBeginCombat(fold(SEED, first), entrants, supplyFrom(first), {
        commandId: 'one-fight',
      }),
      'retry',
    );
    expect(again).toEqual([]);
    expect(fold(SEED, [...first, ...again])).toEqual(fold(SEED, first));
  });

  it('asks about a creature nobody has declared, rather than refusing', () => {
    const out = rollInitiativeAndBeginCombat(
      fold(SEED, CAST),
      [{ id: BREN, speed: 30 }, { id: id('the-chandelier'), speed: 30 }],
      supplyFrom(CAST),
    );
    expect(isNeedsContext(out)).toBe(true);
    expect(contextRequestsOf(out)).not.toEqual([]);
  });

  it('refuses a fight with nobody in it, and one with somebody in it twice', () => {
    expect(isErr(rollInitiativeAndBeginCombat(fold(SEED, CAST), [], supplyFrom(CAST)))).toBe(true);
    expect(
      isErr(
        rollInitiativeAndBeginCombat(
          fold(SEED, CAST),
          [
            { id: BREN, speed: 30 },
            { id: BREN, speed: 30 },
          ],
          supplyFrom(CAST),
        ),
      ),
    ).toBe(true);
  });

  /**
   * A refused fight rolls nothing anybody has to account for.
   *
   * The refusal *is* the whole batch — there are no events to append, so
   * nothing about the world moved — and the claim that matters is the next
   * one: a caller who corrects the list and sends it again gets exactly the
   * dice the first correct call would have got. That is what would fail if the
   * refusal had leaked a `rolls-issued`, or if the command had rolled off a
   * generator it did not resume from state.
   */
  it('leaves the generator where it was when it refuses', () => {
    const refused = rollInitiativeAndBeginCombat(
      fold(SEED, CAST),
      [
        { id: BREN, speed: 30 },
        { id: BREN, speed: 30 },
      ],
      supplyFrom(CAST),
    );
    expect(isErr(refused)).toBe(true);

    // Whatever the refusal handed back is appended, exactly as a caller does
    // with any batch — and a refusal hands back nothing, so this is the world
    // unchanged. **The refusal's output is load-bearing here**: a command that
    // leaked its rolls instead of refusing would put a `rolls-issued` into
    // this log, the supply below would resume past it, and the corrected
    // command would get different dice from the ones `byCommand` got.
    const after: readonly GameEvent[] = [...CAST, ...(refused.ok ? refused.value : [])];
    expect(after).toEqual(CAST);

    const corrected = unwrap(
      rollInitiativeAndBeginCombat(fold(SEED, after), entrants, supplyFrom(after)),
      'fight',
    );
    expect([...after, ...corrected]).toEqual(byCommand());
  });
});

/**
 * The other half of the pair: Initiative rolled without a fight.
 *
 * A DM may ask for Initiative before deciding there is one — and until now the
 * only correct way to do that was to call `rollInitiativeFor` and write the
 * `rolls-issued` event by hand. The roll is still available bare, for anything
 * that wants a number and keeps no log; this is what a log-keeper calls.
 */
describe('Initiative can be rolled without a fight, and still be recorded', () => {
  const rolled = (commandId?: string): readonly GameEvent[] => [
    ...CAST,
    ...unwrap(
      recordInitiativeRolls(
        fold(SEED, CAST),
        entrants,
        supplyFrom(CAST),
        commandId === undefined ? {} : { commandId },
      ),
      'rolls',
    ),
  ];

  it('moves the generator and starts no fight', () => {
    const state = fold(SEED, rolled());
    expect(state.combat).toBeNull();
    expect(state.rollsIssued).toBeGreaterThan(0);
    expect(state.rng).not.toBeNull();
  });

  it('says what each creature rolled, so the DM can decide with the numbers', () => {
    const records = rolled()
      .slice(CAST.length)
      .filter((event) => event.type === 'roll-recorded');
    expect(records.map((event) => (event as { who: CharacterId }).who)).toEqual([BREN, ROWAN]);
  });

  /**
   * And it says what *made* each number.
   *
   * Both these Fighters have the Alert feat, whose Proficiency Bonus the
   * engine applies off the creature rather than out of a caller's hand — so a
   * record that lumped the whole modifier into one contribution would lose the
   * one thing the log is being asked to explain, which is the failure
   * `roll-recorded.contributions` exists to prevent.
   */
  it('names every contribution, and they add up to the total', () => {
    const records = rolled()
      .slice(CAST.length)
      .filter((event) => event.type === 'roll-recorded') as readonly {
      readonly natural: number;
      readonly total: number;
      readonly contributions: readonly { readonly source: string; readonly amount: number }[];
    }[];

    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.contributions.map((c) => c.source)).toContain('Alert');
      const named = record.contributions.reduce((sum, c) => sum + c.amount, 0);
      expect(record.natural + named).toBe(record.total);
    }
  });

  // `startCombat`'s own code for the same caller mistake: an empty list is an
  // empty list whether or not a fight was going to follow it.
  it('refuses a roll for nobody, under the code its sibling already uses', () => {
    const out = recordInitiativeRolls(fold(SEED, CAST), [], supplyFrom(CAST));
    expect(isErr(out)).toBe(true);
    expect(isErr(out) ? out.code : '').toBe('empty_combat');

    const fight = rollInitiativeAndBeginCombat(fold(SEED, CAST), [], supplyFrom(CAST));
    expect(isErr(fight) ? fight.code : '').toBe('empty_combat');
  });

  it('answers a retry under one id with nothing', () => {
    const first = rolled('a-question');
    const again = unwrap(
      recordInitiativeRolls(fold(SEED, first), entrants, supplyFrom(first), {
        commandId: 'a-question',
      }),
      'retry',
    );
    expect(again).toEqual([]);
  });
});

/**
 * And the claim is read off the source rather than promised.
 *
 * A comment saying "do not write this event by hand" is not a test. This is
 * the same shape as `spell-schema.test.ts`'s sweep for a catalogue id in the
 * engine: every file that constructs a `rolls-issued` is either a place the
 * engine emits its own, or is written down here with the reason it may.
 */
describe('nobody writes a rolls-issued event by hand', () => {
  const SRC = fileURLToPath(new URL('.', import.meta.url));
  const ROOT = `${SRC}../../../`;

  /**
   * A construction, not a comparison. `event.type === 'rolls-issued'` and the
   * seam's own `'rolls-issued'` in a list of event names are readings; a
   * `type:` with a colon in front of the string is somebody building one.
   */
  const CONSTRUCTS = /\btype:\s*'rolls-issued'/;

  const walk = (dir: string): readonly string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(`${dir}${entry.name}/`)
        : entry.name.endsWith('.ts')
          ? [`${dir}${entry.name}`]
          : [],
    );

  /**
   * Every TypeScript source in the repository that anybody writes by hand.
   *
   * **Including the script directories**, which is where the two frozen-log
   * generators live. A population of `src` trees would have gone green while
   * `make-golden-log.ts` grew a hand-written event — the shrinking-population
   * failure these sweeps exist to avoid — so the scripts are read as well, and
   * the count below is checked against a floor so a mistyped path cannot make
   * the sweep look at nothing.
   */
  const SOURCES: readonly string[] = [
    `${ROOT}packages/engine/src/`,
    `${ROOT}packages/engine/scripts/`,
    `${ROOT}packages/content/src/`,
    `${ROOT}packages/content/scripts/`,
    `${ROOT}packages/shared/src/`,
    `${ROOT}packages/srd/src/`,
    `${ROOT}packages/srd/scripts/`,
    `${ROOT}tools/llm-probe/src/`,
  ].flatMap((dir) => walk(dir));

  /**
   * The loose files at the repository root, which `walk` cannot be pointed at:
   * recursing from there would descend into `node_modules`. There is one today
   * and it is read by name, so "every source anybody writes by hand" is the
   * whole truth rather than nearly.
   */
  const ROOT_SOURCES: readonly string[] = readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => `${ROOT}${entry.name}`);

  const relative = (file: string) => file.slice(ROOT.length).replace(/\\/g, '/');

  /**
   * Where a `rolls-issued` may be built, and why.
   *
   * The engine's own command modules are not listed because they are the
   * *point*: a command that rolls emits the event that says so, and
   * `commands/` plus `rest.ts` is where commands live. Everything else is
   * named, with its reason, and the list is checked for staleness below.
   */
  const MAY_BUILD_ONE: Readonly<Record<string, string>> = {
    'packages/engine/src/beginning-a-fight.test.ts':
      'this file, which assembles the old log by hand at the top precisely so the new one can be proved to fold to the same fight; the forgery is the control in the experiment',
    'packages/engine/src/events.ts':
      'the declaration of the event type itself, which is where its shape is written down rather than a place one is built',
    'packages/engine/src/invariants.test.ts':
      'the sweep that catches the opposite mistake — a command that rolls and emits *no* `rolls-issued`, which this file has nothing to say about. Its constructions are arguments to a judgement rather than events: a short count, a stale snapshot and an honest record, each handed to `unrecordedRolls` to prove it tells them apart, plus one inside a synthetic module the static half must classify. None of them is appended to a log or folded',
    'packages/engine/src/events.test.ts':
      'a unit test of the seam that owns the event: it builds a two-event log by hand precisely to prove that this is the only thing that moves the generator',
    'packages/engine/src/scenario.test.ts':
      'the scripted four-round fight, driven against the raw roll functions beneath the command layer on purpose; it is the determinism ship criterion and its log does not move',
    'tools/llm-probe/src/surface.ts':
      'the DM-ruling damage tool rolls free-form dice the engine has no command for; a separate debt of the same shape, named here rather than fixed by this change',
  };

  const builders = [...SOURCES, ...ROOT_SOURCES]
    .filter((file) => CONSTRUCTS.test(readFileSync(file, 'utf8')))
    .map(relative);

  const engineCommand = (file: string) =>
    file.startsWith('packages/engine/src/commands/') || file === 'packages/engine/src/rest.ts';

  it('finds one nowhere but a command and the places that say why', () => {
    const unaccounted = builders
      .filter((file) => !engineCommand(file) && MAY_BUILD_ONE[file] === undefined)
      .sort();
    expect(unaccounted).toEqual([]);
  });

  /** And the engine really does emit its own, so the sweep is not looking at nothing. */
  it('reads a population with the engine’s emitters in it', () => {
    expect(SOURCES.length).toBeGreaterThan(100);
    expect(SOURCES.map(relative)).toContain('packages/engine/scripts/make-golden-log.ts');
    expect(SOURCES.map(relative)).toContain('packages/srd/scripts/ingest.ts');
    expect(ROOT_SOURCES.map(relative)).toContain('vitest.config.ts');
    expect(builders.filter(engineCommand).length).toBeGreaterThan(5);
    expect(builders).toContain('packages/engine/src/commands/initiative.ts');
  });

  /** No stale reason: every file excused here still builds one. */
  it('keeps no excuse for a file that stopped', () => {
    expect(Object.keys(MAY_BUILD_ONE).filter((file) => !builders.includes(file))).toEqual([]);
    expect(Object.values(MAY_BUILD_ONE).every((reason) => reason.length > 20)).toBe(true);
  });

  /** And it would catch one: the pattern finds a construction and not a reading. */
  it('would catch a caller that started writing one', () => {
    expect(CONSTRUCTS.test("push({ type: 'rolls-issued', count: 1, rng: rng.snapshot() });")).toBe(
      true,
    );
    expect(CONSTRUCTS.test("if (event.type === 'rolls-issued') return next;")).toBe(false);
    expect(CONSTRUCTS.test("export const ROLLS_EVENTS = ['roll-recorded', 'rolls-issued'];")).toBe(
      false,
    );
  });

  /** The two the probe used to write are gone, by name. */
  it('no longer finds the probe assembling one to begin a fight', () => {
    expect(builders).not.toContain('tools/llm-probe/src/harness.ts');
    expect(builders).not.toContain('tools/llm-probe/src/parity.test.ts');
  });
});
