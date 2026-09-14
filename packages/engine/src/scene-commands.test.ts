import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  contextRequestsOf,
  isErr,
  isNeedsContext,
  expect as unwrap,
  type Result,
} from '@ie/shared';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { type CommandIdentity } from './idempotency.js';
import {
  addSceneLandmark,
  advanceTime,
  beginCombat,
  declareCoverBetween,
  declareSightBetween,
  declareSpellcasting,
  placeCreatureInScene,
  rollInitiativeFor,
  setScene,
} from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { coverBetween, positionOf, sightBetween } from './positioning.js';
import { declaredCasting } from './spellcasting.js';

/**
 * Starting an encounter, which nothing above the engine could do.
 *
 * `placeCreature`, `addLandmark`, `declareCover`, `declareSight` and
 * `startCombat` have been correct pure functions since positioning and combat
 * landed, and every one of them was called by exactly one caller: the
 * **reducer**, folding an event no command wrote. `scene-set`, `time-advanced`
 * and `spellcasting-declared` had no producer outside a test fixture at all.
 * So the only way to begin a fight was to hand-write the log, which is
 * narration writing directly to truth.
 *
 * This is the twelfth recorded instance of the repository's most persistent
 * finding — a rule implemented and reachable from nothing — and the largest.
 *
 * The decisions this file pins, and which the nine DM-declared events in
 * `declared-fact-commands.test.ts` went on to follow:
 *
 * - **The command is its event's name read as an imperative**, lengthened
 *   where the pure function beneath already owns the plain verb.
 * - **A command refuses exactly what the reducer would call corrupt, and
 *   nothing more.** Every refusal below is paired with the hand-written event
 *   that throws, which is what makes that sentence a test rather than a claim.
 * - **A missing fact is homework**, not a verdict, and the request says which
 *   fact and about whom — a `scene` when there is no room, a `position` when
 *   the creature a placement is *measured from* is not standing anywhere.
 * - **`mayAct` is not consulted.** None of these is an action in the turn
 *   economy; they are facts a DM declares.
 */

const id = (s: string) => asCharacterId(s);
const BREN = id('bren');
const ROWAN = id('rowan');
const PRIEST = id('priest');

const supply = (seed = 'scene') => ({ issuer: createRollIssuer('r'), rng: createRng(seed) as Rng });

/** A level 1 Fighter, so that every creature in this file arrives by command. */
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

/**
 * A log built only from things the engine produced.
 *
 * Nothing here writes an event literal, which is the whole point of the
 * file — see the scenario at the bottom, where that claim is checked against
 * this source rather than asserted.
 */
class Table {
  private readonly log: GameEvent[] = [];

  get state(): GameState {
    return fold('scene', this.log);
  }

  get events(): readonly GameEvent[] {
    return this.log;
  }

  do(step: string, produce: (state: GameState) => Result<readonly GameEvent[]>): GameState {
    this.log.push(...unwrap(produce(this.state), step));
    return this.state;
  }
}

/** Two creatures on the board, by command, before any scene exists. */
const cast = (): Table => {
  const table = new Table();
  table.do('bren', () => createCharacter(walkOn('Bren'), BREN));
  table.do('rowan', () => createCharacter(walkOn('Rowan'), ROWAN));
  return table;
};

/** The same, with a scene set and both creatures standing in it. */
const room = (): Table => {
  const table = cast();
  table.do('scene', (s) => setScene(s, { width: 300, depth: 300, height: 40 }));
  table.do('bar', (s) => addSceneLandmark(s, 'the bar', { x: 100, y: 100, z: 0 }));
  table.do('bren stands', (s) =>
    placeCreatureInScene(s, BREN, { from: { landmark: 'the bar' }, feet: 0 }),
  );
  table.do('rowan stands', (s) =>
    placeCreatureInScene(s, ROWAN, { from: { creature: BREN }, feet: 10, bearing: 0 }),
  );
  return table;
};

describe('each scene command emits its event, folds it, and answers a retry with nothing', () => {
  /**
   * One case per command: the event it always emits, the state that event
   * folds to, and the empty batch a retry under the same id comes back with.
   *
   * `placeCreatureInScene` is the one whose own first run makes the world
   * refuse the second — `already_placed` — which is the exact trap this
   * repository has sprung eight times, and `once` is why it cannot be sprung
   * here. It gets a case of its own below the table as well, because the table
   * cannot say *which* refusal a hoisted guard would have produced.
   */
  const commands: readonly {
    readonly name: string;
    readonly emits: GameEvent['type'];
    readonly log: () => Table;
    readonly run: (state: GameState, sent?: CommandIdentity) => Result<readonly GameEvent[]>;
    readonly landed: (state: GameState) => unknown;
    readonly expected: unknown;
  }[] = [
    {
      name: 'setScene',
      emits: 'scene-set',
      log: cast,
      run: (s, sent) => setScene(s, { width: 60, depth: 40, height: 20 }, sent),
      landed: (s) => s.scene?.extent,
      expected: { width: 60, depth: 40, height: 20 },
    },
    {
      name: 'addSceneLandmark',
      emits: 'landmark-added',
      log: room,
      run: (s, sent) => addSceneLandmark(s, 'the hearth', { x: 20, y: 30, z: 0 }, sent),
      landed: (s) => s.scene?.landmarks['the hearth'],
      expected: { x: 20, y: 30, z: 0 },
    },
    {
      name: 'placeCreatureInScene',
      emits: 'creature-placed',
      log: () => {
        const table = cast();
        table.do('scene', (s) => setScene(s, { width: 300, depth: 300, height: 40 }));
        table.do('bar', (s) => addSceneLandmark(s, 'the bar', { x: 100, y: 100, z: 0 }));
        return table;
      },
      run: (s, sent) =>
        placeCreatureInScene(s, BREN, { from: { landmark: 'the bar' }, feet: 0 }, sent),
      landed: (s) => (s.scene === null ? null : positionOf(s.scene, BREN)),
      expected: { x: 100, y: 100, z: 0 },
    },
    {
      name: 'declareSightBetween',
      emits: 'sight-declared',
      log: room,
      run: (s, sent) => declareSightBetween(s, BREN, ROWAN, true, sent),
      landed: (s) => (s.scene === null ? null : sightBetween(s.scene, BREN, ROWAN)),
      expected: true,
    },
    {
      name: 'declareCoverBetween',
      emits: 'cover-declared',
      log: room,
      run: (s, sent) => declareCoverBetween(s, BREN, ROWAN, 'three-quarters', sent),
      landed: (s) => (s.scene === null ? null : coverBetween(s.scene, BREN, ROWAN)),
      expected: 'three-quarters',
    },
    {
      name: 'beginCombat',
      emits: 'combat-started',
      log: room,
      run: (s, sent) =>
        beginCombat(
          s,
          [
            { id: BREN, initiative: 18, speed: 30 },
            { id: ROWAN, initiative: 4, speed: 30 },
          ],
          sent,
        ),
      landed: (s) => s.combat?.order.map((c) => c.id),
      expected: [BREN, ROWAN],
    },
    {
      name: 'advanceTime',
      emits: 'time-advanced',
      log: cast,
      run: (s, sent) => advanceTime(s, 600, 'searching the vault', sent),
      landed: (s) => s.elapsed,
      expected: 600,
    },
    {
      name: 'declareSpellcasting',
      emits: 'spellcasting-declared',
      log: cast,
      run: (s, sent) =>
        declareSpellcasting(s, BREN, declaredCasting({ ability: 'wis', prepared: ['bless'] }), sent),
      landed: (s) => s.creatures[BREN]?.spellcasting.classes.map((c) => c.ability),
      expected: ['wis'],
    },
  ];

  for (const command of commands) {
    it(`${command.name} emits ${command.emits} and folds it`, () => {
      const table = command.log();
      const events = unwrap(command.run(table.state), command.name);
      expect(events.map((e) => e.type)).toEqual([command.emits]);
      expect(command.landed(fold('scene', [...table.events, ...events]))).toEqual(command.expected);
    });

    it(`${command.name} answers a retry under one id with nothing`, () => {
      const table = command.log();
      const first = unwrap(command.run(table.state, { commandId: 'one' }), command.name);
      expect(first.length).toBe(1);
      const after = fold('scene', [...table.events, ...first]);
      const retry = command.run(after, { commandId: 'one' });
      expect(isErr(retry) ? retry.code : 'ok').toBe('ok');
      expect(unwrap(retry, `${command.name} retried`)).toEqual([]);
    });

    it(`${command.name} stamps the event it emits, so the fold remembers it`, () => {
      const table = command.log();
      const first = unwrap(command.run(table.state, { commandId: 'one' }), command.name);
      expect(fold('scene', [...table.events, ...first]).appliedCommands['one']).toBeDefined();
    });

    it(`${command.name} refuses an id already spent on different work`, () => {
      const table = command.log();
      const first = unwrap(command.run(table.state, { commandId: 'one' }), command.name);
      const after = fold('scene', [...table.events, ...first]);
      const other = advanceTime(after, 12, 'something else entirely', { commandId: 'one' });
      expect(isErr(other) ? other.code : 'ok').toBe('command_id_reused');
    });
  }

  /**
   * And the world the first run made does not answer for the retry.
   *
   * A guard written above the duplicate check would report `already_placed`
   * here — true of the world, and the wrong answer to the question the caller
   * asked, which was "did my command land?". CLAUDE.md's `once` section
   * enumerates eight occasions on which that was got wrong; this is the test
   * written before a ninth.
   */
  it('tells a retry its command landed, not what its own first run did', () => {
    const table = cast();
    table.do('scene', (s) => setScene(s, { width: 300, depth: 300, height: 40 }));
    table.do('bar', (s) => addSceneLandmark(s, 'the bar', { x: 100, y: 100, z: 0 }));

    const placement = { from: { landmark: 'the bar' }, feet: 0 } as const;
    const first = unwrap(
      placeCreatureInScene(table.state, BREN, placement, { commandId: 'walk-in' }),
      'first',
    );
    const after = fold('scene', [...table.events, ...first]);

    // The world now refuses this placement outright...
    const unstamped = placeCreatureInScene(after, BREN, placement);
    expect(isErr(unstamped) ? unstamped.code : 'ok').toBe('already_placed');

    // ...and the retry is told its command landed anyway.
    expect(unwrap(placeCreatureInScene(after, BREN, placement, { commandId: 'walk-in' }), 'retry'))
      .toEqual([]);
  });
});

/**
 * **Where the stamp-declaration sweep went, and why it is not here.**
 *
 * This file used to hold it, scoped to `commands/scene.ts` by a hard-coded
 * path — which meant a module added later was invisible to it unless somebody
 * remembered the list. IE-016 needed three more modules in that scope, so the
 * sweep became a directory listing over every module under `commands/` and
 * moved to `invariants.test.ts`, where the other directory-derived sweeps
 * live. A sweep about the whole command layer filed under one family's name is
 * the same fragility wearing different clothes.
 */

describe('a scene command refuses exactly what the reducer would call corrupt', () => {
  /**
   * The brief's second requirement, made checkable: the refusal is the pure
   * function's own, surfaced rather than restated. So each case pairs the
   * command's refusal with the hand-written event that reaches the same rule
   * through `must` and throws — which is the only way to show the two agree
   * rather than merely both existing.
   */
  const cases: readonly {
    readonly name: string;
    readonly code: string;
    readonly homework: boolean;
    /**
     * What a homework refusal must actually *ask* for. A `needs-context` with
     * no request is "go and find out" with the "what" left in a prose string,
     * and the layer above is back to matching error codes — which is the thing
     * the structured half exists to make unnecessary.
     *
     * `satisfiedBy` is spelled out per case rather than ruled on, because the
     * honest answer differs: this module's own requests name a **command**,
     * and the shared stranger refusal names the `creature-added` **event**,
     * because `creature-added` is one of the nine types that still has no
     * command and pointing at one would be a lie.
     */
    readonly wants?: {
      readonly kind: string;
      readonly subject: string;
      readonly satisfiedBy: RegExp;
    };
    readonly log: () => Table;
    readonly run: (state: GameState) => Result<unknown>;
    readonly forged: (state: GameState) => GameEvent;
  }[] = [
    {
      name: 'a landmark outside the scene',
      code: 'outside_scene',
      homework: false,
      log: room,
      run: (s) => addSceneLandmark(s, 'the moon', { x: 5000, y: 5000, z: 0 }),
      forged: () => ({ type: 'landmark-added', name: 'the moon', at: { x: 5000, y: 5000, z: 0 } }),
    },
    {
      name: 'placing somebody who is already standing somewhere',
      code: 'already_placed',
      homework: false,
      log: room,
      run: (s) => placeCreatureInScene(s, BREN, { from: { landmark: 'the bar' }, feet: 0 }),
      forged: () => ({
        type: 'creature-placed',
        id: BREN,
        placement: { from: { landmark: 'the bar' }, feet: 0 },
      }),
    },
    {
      name: 'placing somebody against a landmark nobody has named',
      code: 'unknown_anchor',
      homework: false,
      log: () => {
        const table = cast();
        table.do('scene', (s) => setScene(s, { width: 300, depth: 300, height: 40 }));
        return table;
      },
      run: (s) => placeCreatureInScene(s, BREN, { from: { landmark: 'nowhere' }, feet: 0 }),
      forged: () => ({
        type: 'creature-placed',
        id: BREN,
        placement: { from: { landmark: 'nowhere' }, feet: 0 },
      }),
    },
    {
      name: 'a creature seeing itself',
      code: 'same_creature',
      homework: false,
      log: room,
      run: (s) => declareSightBetween(s, BREN, BREN, true),
      forged: () => ({ type: 'sight-declared', from: BREN, to: BREN, seen: true }),
    },
    {
      name: 'a combat with nobody in it',
      code: 'empty_combat',
      homework: false,
      log: room,
      run: (s) => beginCombat(s, []),
      forged: () => ({ type: 'combat-started', combatants: [] }),
    },
    {
      name: 'a combatant listed twice',
      code: 'duplicate_combatant',
      homework: false,
      log: room,
      run: (s) =>
        beginCombat(s, [
          { id: BREN, initiative: 10, speed: 30 },
          { id: BREN, initiative: 4, speed: 30 },
        ]),
      forged: () => ({
        type: 'combat-started',
        combatants: [
          { id: BREN, initiative: 10, speed: 30 },
          { id: BREN, initiative: 4, speed: 30 },
        ],
      }),
    },
    {
      name: 'time running backwards',
      code: 'not_whole_seconds',
      homework: false,
      log: cast,
      run: (s) => advanceTime(s, -30, 'unwinding the clock'),
      forged: () => ({ type: 'time-advanced', seconds: -30, reason: 'unwinding the clock' }),
    },
    {
      name: 'time in fractions of a second',
      code: 'not_whole_seconds',
      homework: false,
      log: cast,
      run: (s) => advanceTime(s, 1.5, 'a moment'),
      forged: () => ({ type: 'time-advanced', seconds: 1.5, reason: 'a moment' }),
    },
    {
      name: 'spellcasting for a creature nobody has mentioned',
      code: 'unknown_creature',
      homework: true,
      wants: { kind: 'creature', subject: PRIEST, satisfiedBy: /addCreature command/ },
      log: cast,
      run: (s) => declareSpellcasting(s, PRIEST, declaredCasting({ ability: 'wis' })),
      forged: () => ({
        type: 'spellcasting-declared',
        id: PRIEST,
        spellcasting: declaredCasting({ ability: 'wis' }),
      }),
    },
    {
      /**
       * The second kind of homework, and the one the four `no_scene` cases
       * below cannot reach: the scene exists, and the creature the placement
       * is *measured from* has no position.
       *
       * `resolveAnchor` answers that with a bare `unplaced` and no request,
       * which is the right division of labour — a pure helper returns the kind
       * and the command that knows which rule wanted the fact attaches the
       * request. Passing it straight through leaves the command saying "go and
       * find out" with the "what" in a prose string, which is the one thing a
       * tool surface cannot branch on.
       */
      name: 'placing somebody beside a creature nobody has placed',
      code: 'unplaced',
      homework: true,
      // The anchor, not the creature being placed: Rowan is fine, and it is
      // Bren's position that is missing.
      wants: { kind: 'position', subject: BREN, satisfiedBy: /placeCreatureInScene command/ },
      log: () => {
        const table = cast();
        table.do('scene', (s) => setScene(s, { width: 300, depth: 300, height: 40 }));
        return table;
      },
      run: (s) => placeCreatureInScene(s, ROWAN, { from: { creature: BREN }, feet: 5, bearing: 0 }),
      forged: () => ({
        type: 'creature-placed',
        id: ROWAN,
        placement: { from: { creature: BREN }, feet: 5, bearing: 0 },
      }),
    },
    {
      name: 'a landmark with no scene to sit in',
      code: 'no_scene',
      homework: true,
      wants: { kind: 'scene', subject: 'the bar', satisfiedBy: /setScene command/ },
      log: cast,
      run: (s) => addSceneLandmark(s, 'the bar', { x: 1, y: 1, z: 0 }),
      forged: () => ({ type: 'landmark-added', name: 'the bar', at: { x: 1, y: 1, z: 0 } }),
    },
    {
      name: 'a placement with no scene to stand in',
      code: 'no_scene',
      homework: true,
      wants: { kind: 'scene', subject: BREN, satisfiedBy: /setScene command/ },
      log: cast,
      run: (s) => placeCreatureInScene(s, BREN, { from: { sceneCenter: true }, feet: 0 }),
      forged: () => ({
        type: 'creature-placed',
        id: BREN,
        placement: { from: { sceneCenter: true }, feet: 0 },
      }),
    },
    {
      name: 'sight with no scene to see across',
      code: 'no_scene',
      homework: true,
      wants: { kind: 'scene', subject: BREN, satisfiedBy: /setScene command/ },
      log: cast,
      run: (s) => declareSightBetween(s, BREN, ROWAN, true),
      forged: () => ({ type: 'sight-declared', from: BREN, to: ROWAN, seen: true }),
    },
    {
      name: 'cover with no scene to hide in',
      code: 'no_scene',
      homework: true,
      wants: { kind: 'scene', subject: BREN, satisfiedBy: /setScene command/ },
      log: cast,
      run: (s) => declareCoverBetween(s, BREN, ROWAN, 'half'),
      forged: () => ({ type: 'cover-declared', from: BREN, to: ROWAN, degree: 'half' }),
    },
  ];

  for (const entry of cases) {
    it(`${entry.name} is refused, and costs nothing`, () => {
      const table = entry.log();
      const before = table.state;
      const out = entry.run(before);
      expect(isErr(out) ? out.code : 'ok').toBe(entry.code);
      // Nothing was spent: the state the refusal was measured against is the
      // state that survives it, byte for byte.
      expect(table.state).toEqual(before);
    });

    /**
     * And the command is refusing the rule rather than a rule of its own: the
     * very event it declined to write is a corrupt log.
     */
    it(`${entry.name} is what the reducer would call corrupt`, () => {
      const table = entry.log();
      let thrown: unknown = null;
      try {
        fold('scene', [...table.events, entry.forged(table.state)]);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).name).toBe('CorruptLogError');
    });

    it(`${entry.name} is ${entry.homework ? 'homework' : 'a verdict'}`, () => {
      const out = entry.run(entry.log().state);
      expect(isNeedsContext(out)).toBe(entry.homework);
      if (!entry.homework) return;

      const requests = contextRequestsOf(out);
      expect(requests.length).toBeGreaterThan(0);
      for (const request of requests) {
        expect(request.subject.length).toBeGreaterThan(0);
        expect(request.need.length).toBeGreaterThan(0);
        expect(request.because.length).toBeGreaterThan(0);
      }

      // And it asks for the right thing about the right subject, which "there
      // is at least one request" cannot say — the anchor case is the one where
      // the subject is a *different* creature from the one being placed.
      const wanted = requests.find(
        (r) => r.kind === entry.wants!.kind && r.subject === entry.wants!.subject,
      );
      expect(wanted, `${entry.wants!.kind} for ${entry.wants!.subject}`).toBeDefined();
      expect(wanted!.satisfyWith).toMatch(entry.wants!.satisfiedBy);
    });
  }

  /**
   * A scene may be set again — a new room is not a contradiction — and the
   * engine has always unplaced everybody when it happens. That is the one
   * durable-looking fact in the family that is deliberately not durable, so it
   * is pinned rather than left to be inferred from the absence of a refusal.
   */
  it('lets a new scene replace the old one, and unplaces everybody', () => {
    const table = room();
    expect(positionOf(table.state.scene!, BREN)).not.toBeNull();
    table.do('a new room', (s) => setScene(s, { width: 100, depth: 100, height: 20 }));
    expect(table.state.scene?.extent.width).toBe(100);
    expect(positionOf(table.state.scene!, BREN)).toBeNull();
  });
});

describe('an encounter, from nothing, through commands only', () => {
  /**
   * **This is the point of the task.** Every event in this log was produced by
   * something the engine exports; not one of them is written down here. Until
   * these commands existed the only way to reach a started fight was to forge
   * the log by hand, which is the layer above writing straight to truth.
   */
  const encounter = (): Table => {
    const table = new Table();

    table.do('the fighter arrives', () => createCharacter(walkOn('Bren'), BREN));
    table.do('the scout arrives', () => createCharacter(walkOn('Rowan'), ROWAN));
    table.do('the priest arrives', () => createCharacter(walkOn('Ysolde'), PRIEST));

    // The priest has no class table that casts; the DM says what she casts.
    table.do('the priest is more than she seemed', (s) =>
      declareSpellcasting(s, PRIEST, declaredCasting({ ability: 'wis', prepared: ['bless'] })),
    );

    table.do('an hour in the hall', (s) => advanceTime(s, 3600, 'the party waits out the storm'));

    table.do('the taproom', (s) => setScene(s, { width: 60, depth: 40, height: 20 }));
    table.do('the bar', (s) => addSceneLandmark(s, 'the bar', { x: 10, y: 20, z: 0 }));
    table.do('the door', (s) => addSceneLandmark(s, 'the door', { x: 50, y: 20, z: 0 }));

    table.do('Bren at the bar', (s) =>
      placeCreatureInScene(s, BREN, { from: { landmark: 'the bar' }, feet: 0 }),
    );
    table.do('Ysolde beside him', (s) =>
      placeCreatureInScene(s, PRIEST, { from: { creature: BREN }, feet: 5, bearing: 90 }),
    );
    table.do('Rowan in the doorway', (s) =>
      placeCreatureInScene(s, ROWAN, { from: { landmark: 'the door' }, feet: 0 }),
    );

    table.do('Bren sees the doorway', (s) => declareSightBetween(s, BREN, ROWAN, true));
    table.do('and is seen', (s) => declareSightBetween(s, ROWAN, BREN, true));
    table.do('the bar shields Bren', (s) => declareCoverBetween(s, ROWAN, BREN, 'half'));

    // Rolled, not chosen: the order is whatever the dice said.
    const dice = supply();
    const rolled = [BREN, PRIEST, ROWAN].map((who) => {
      const roll = unwrap(rollInitiativeFor(table.state, who, dice.issuer, dice.rng), 'initiative');
      return { id: who, initiative: roll.total, speed: 30 };
    });
    table.do('roll for Initiative', (s) => beginCombat(s, rolled));

    return table;
  };

  it('reaches a started fight with everybody standing where they were put', () => {
    const state = encounter().state;

    expect(state.combat).not.toBeNull();
    expect(state.combat?.order.map((c) => c.id).sort()).toEqual([BREN, PRIEST, ROWAN].sort());
    // The order is sorted by Initiative, highest first.
    const totals = state.combat!.order.map((c) => c.initiative);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
    // And the fight has a turn to be on, with a budget to spend.
    expect(state.combat?.round).toBe(1);
    expect(state.combat?.budgets[state.combat.order[0]!.id]?.action).toBe(true);
  });

  it('carries the scene, the landmarks, the placements, the sight and the cover', () => {
    const scene = encounter().state.scene!;

    expect(scene.extent).toEqual({ width: 60, depth: 40, height: 20 });
    expect(Object.keys(scene.landmarks).sort()).toEqual(['the bar', 'the door']);
    expect(positionOf(scene, BREN)).toEqual({ x: 10, y: 20, z: 0 });
    expect(positionOf(scene, ROWAN)).toEqual({ x: 50, y: 20, z: 0 });
    expect(positionOf(scene, PRIEST)).not.toBeNull();
    expect(sightBetween(scene, BREN, ROWAN)).toBe(true);
    expect(sightBetween(scene, ROWAN, BREN)).toBe(true);
    // Directional, and nobody said the other way.
    expect(coverBetween(scene, ROWAN, BREN)).toBe('half');
    expect(coverBetween(scene, BREN, ROWAN)).toBe('none');
  });

  it('advanced the clock and declared the priest’s spellcasting on the way', () => {
    const state = encounter().state;
    expect(state.elapsed).toBe(3600);
    expect(state.creatures[PRIEST]?.spellcasting.classes[0]?.ability).toBe('wis');
  });

  it('replays byte-identically, which is what makes it a log rather than a script', () => {
    const log = encounter().events;
    expect(fold('scene', log)).toEqual(fold('scene', log));
    expect(encounter().events).toEqual(log);
  });

  /**
   * And the claim above is read off this file rather than promised.
   *
   * A scenario that quietly hand-writes one event proves nothing about
   * whether a caller could have got here, and "no hand-written event
   * anywhere in it" is precisely the acceptance criterion. So the builder is
   * scanned for the one thing that would break it: an event literal.
   */
  it('writes no event by hand', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const opener = source.indexOf('const encounter = (): Table => {');
    const closer = source.indexOf('\n  };', opener);
    expect(opener).toBeGreaterThan(-1);
    expect(closer).toBeGreaterThan(opener);
    const body = source.slice(opener, closer);
    expect(body).not.toMatch(/\btype: '/);

    // And the scan would see one if it were there: the refusal fixtures above
    // forge events deliberately, and this is the pattern that finds them.
    expect(source.slice(0, opener)).toMatch(/\btype: '/);
  });
});
