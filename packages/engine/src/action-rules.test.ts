import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { loadContent, type Content } from './content.js';
import { checkSpellDefinition, checkSpellDefinitionValue } from './spell-schema.js';
import {
  endConcentration,
  resolveMove,
  resolveSpell,
  resolveTurn,
  takeDash,
  takeDisengage,
  takeDodge,
  takeReady,
  releaseReady,
} from './commands.js';

/**
 * An action a spell compels or forbids — the ninth sourced grant.
 *
 * The SRD writes this sentence twenty-nine times and the engine could say
 * none of it. `mayAct` guards every spender and answers a question about
 * *debt*; the only lever a spell had on the action economy was a condition
 * the engine names, and there is no condition in the book that forbids the
 * Magic action and leaves the rest of a turn alone.
 *
 * Three sentences, one per member of the rule vocabulary, and every one of
 * them is a real SRD paragraph this file transcribes into homebrew because
 * the catalogue belongs to somebody else this batch:
 *
 * > Stinking Cloud: "While Poisoned in this way, the creature **can't take an
 * > action or a Bonus Action**." — `forbids`
 *
 * > Wind Walk: "**The only actions a target can take** in this form are the
 * > Dash action, the Hide action, and the Search action." — `permits-only`
 *
 * > Conjure Woodland Beings: "**you can take the Disengage action as a Bonus
 * > Action** for the spell's duration." — `allows`
 *
 * **The engine does not play creatures.** A compulsion is therefore a fact
 * about what is *legal* and never an instruction that executes: SRD Fear's
 * "must take the Dash action" is written here as "the only action it may take
 * is Dash", the engine refuses everything else, and whether the Dash actually
 * happens is the table's. The sentences that go the other way — the ones that
 * *spend* somebody else's budget, Dissonant Whispers' forced Reaction,
 * Compulsion's designated direction, the three Dominates' telepathic link —
 * are a different shape and are deliberately still open. See
 * {@link ActionRule} in `combat.ts`, where that argument lives beside the
 * code.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const CASTER = id('caster');
const TARGET = id('target');
const BYSTANDER = id('bystander');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 10, con: 10, int: 20, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

/** A Wisdom of 1 fails every save these spells ask for, so no die decides a fixture. */
const FRAIL = { str: 10, dex: 10, con: 10, int: 10, wis: 1, cha: 10 } as const;

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

// — the three sentences, as homebrew ————————————————————————————————————————

/**
 * SRD Stinking Cloud's second sentence, on a save rather than in an area.
 *
 * A `save` host, so the rule rides a settled outcome exactly as the book
 * writes it: the Poisoned lands and the restriction rides the same failure.
 * A second effect would roll a second save for one sentence.
 */
const BINDING_WORD = JSON.stringify({
  id: 'binding-word',
  name: 'Binding Word',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  durationSeconds: 60,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  effects: [
    {
      kind: 'save',
      ability: 'wis',
      condition: 'poisoned',
      modifiers: [
        { kind: 'action', rule: { kind: 'forbids', slots: ['action', 'bonus-action'] } },
      ],
    },
  ],
});

/**
 * SRD Shocking Grasp's clause, which is why a rider carries `lasts`.
 *
 * A cantrip, Instantaneous, so the casting is over the instant it resolves
 * and nothing it hung could ever be taken off again — the argument Ray of
 * Frost already made for `speed-change`, arriving on the member beside it.
 */
const STILLING_TOUCH = JSON.stringify({
  id: 'stilling-touch',
  name: 'Stilling Touch',
  level: 0,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1 },
  effects: [
    {
      kind: 'attack',
      attack: 'melee',
      damage: { dice: '1d8' },
      damageType: 'lightning',
      modifiers: [
        {
          kind: 'action',
          rule: { kind: 'forbids', actions: ['opportunity-attack'] },
          lasts: 'start-of-casters-next-turn',
        },
      ],
    },
  ],
});

/**
 * SRD Fear's compulsion, read as the legality it is.
 *
 * "must take the Dash action" becomes "the only action it may take is Dash":
 * the engine refuses the rest of the Action slot and never makes anybody run.
 */
const HARRYING_WORD = JSON.stringify({
  id: 'harrying-word',
  name: 'Harrying Word',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  durationSeconds: 60,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  effects: [
    {
      kind: 'save',
      ability: 'wis',
      condition: 'frightened',
      modifiers: [
        { kind: 'action', rule: { kind: 'permits-only', slot: 'action', actions: ['dash'] } },
      ],
    },
  ],
});

/**
 * SRD Conjure Woodland Beings' allowance — the polarity that widens.
 *
 * A standalone effect rather than a rider, because the book asks for no roll:
 * this is the shape `armor-class`, `damage-defense` and `speed` already take.
 */
const NIMBLE_STEP = JSON.stringify({
  id: 'nimble-step',
  name: 'Nimble Step',
  level: 1,
  school: 'conjuration',
  castingTime: 'action',
  concentration: true,
  durationSeconds: 600,
  range: { kind: 'self' },
  targets: { count: 1, self: true },
  effects: [
    { kind: 'action-rule', rule: { kind: 'allows', action: 'disengage', from: 'bonus-action' } },
  ],
});

/**
 * SRD Slow: "it can't take Reactions", and SRD Tsunami: "it can't move".
 *
 * Two slots the Action-shaped fixtures above never reach. One casting carries
 * one rule — the fold keys a rule by its source, so a sentence naming two
 * slots is one rule with two, which is exactly how the SRD writes Stinking
 * Cloud's.
 */
const STILLING_WORD = JSON.stringify({
  id: 'stilling-word',
  name: 'Stilling Word',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  durationSeconds: 60,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  effects: [
    {
      kind: 'save',
      ability: 'wis',
      condition: 'poisoned',
      modifiers: [
        { kind: 'action', rule: { kind: 'forbids', slots: ['reaction', 'movement'] } },
      ],
    },
  ],
});

/**
 * SRD Befuddlement: the target "can't cast spells or take the Magic action".
 *
 * The **named** axis with no slot in it, which is the half of `forbids` the
 * slot fixtures cannot reach: the Action slot stays open and the Magic action
 * alone is gone.
 */
const BEFUDDLING_WORD = JSON.stringify({
  id: 'befuddling-word',
  name: 'Befuddling Word',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  concentration: true,
  durationSeconds: 60,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  effects: [
    {
      kind: 'save',
      ability: 'wis',
      condition: 'poisoned',
      modifiers: [{ kind: 'action', rule: { kind: 'forbids', actions: ['magic'] } }],
    },
  ],
});

/**
 * Something for the victim to cast, so a Bonus Action and a Magic action have
 * a spender the fixtures can actually reach.
 */
const QUICK_SPARK = JSON.stringify({
  id: 'quick-spark',
  name: 'Quick Spark',
  level: 0,
  school: 'evocation',
  castingTime: 'bonus-action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1 },
  effects: [{ kind: 'attack', attack: 'ranged', damage: { dice: '1d6' }, damageType: 'fire' }],
});

const HOMEBREW = unwrap(
  loadContent({
    spells: [
      JSON.parse(BINDING_WORD),
      JSON.parse(STILLING_TOUCH),
      JSON.parse(HARRYING_WORD),
      JSON.parse(NIMBLE_STEP),
      JSON.parse(STILLING_WORD),
      JSON.parse(BEFUDDLING_WORD),
      JSON.parse(QUICK_SPARK),
    ],
  }),
  'load',
);

const PREPARED = ['binding-word', 'harrying-word', 'nimble-step', 'stilling-word', 'befuddling-word'];

const PLACED: readonly GameEvent[] = [
  added(CASTER),
  added(TARGET, { abilities: FRAIL }),
  added(BYSTANDER, { abilities: FRAIL }),
  ...[1, 2].map(
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
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({
      ability: 'int',
      cantrips: ['stilling-touch'],
      prepared: PREPARED,
    }),
  },
  // The victim casts as well, because a Bonus Action and the Magic action
  // have no other spender in this engine that a fixture can reach.
  {
    type: 'spellcasting-declared',
    id: TARGET,
    spellcasting: declaredCasting({ ability: 'int', cantrips: ['quick-spark'], prepared: [] }),
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'here', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'here' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: TARGET,
    placement: { from: { creature: CASTER }, feet: 5, bearing: 0 },
  },
  {
    type: 'creature-placed',
    id: BYSTANDER,
    placement: { from: { creature: CASTER }, feet: 10, bearing: 90 },
  },
  { type: 'sight-declared', from: CASTER, to: TARGET, seen: true },
  { type: 'sight-declared', from: CASTER, to: BYSTANDER, seen: true },
];

/** The caster acts first, so "the start of your next turn" is a whole round away. */
const SETUP: readonly GameEvent[] = [
  ...PLACED,
  {
    type: 'combat-started',
    combatants: [
      { id: CASTER, initiative: 20, speed: 30 },
      { id: TARGET, initiative: 10, speed: 30 },
      { id: BYSTANDER, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (seed: string, content: Content = HOMEBREW) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content,
});

const must = <T,>(result: Result<T>): T => unwrap(result, 'action rules');

const applyAll = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce(applyEvent, state);

/** Advance to whoever is next, settling whatever the boundary owes. */
const nextTurn = (log: readonly GameEvent[]): readonly GameEvent[] => [
  ...log,
  ...must(resolveTurn(fold('seed', log), supply('turn'))).events,
];

const whoseTurn = (state: GameState): CharacterId | undefined =>
  state.combat?.order[state.combat.turnIndex]?.id;

/** Wind the order round to the named creature's turn, advancing if need be. */
const turnOf = (log: readonly GameEvent[], who: CharacterId): readonly GameEvent[] => {
  let current = log;
  for (let i = 0; i < 8; i += 1) {
    if (whoseTurn(fold('seed', current)) === who) return current;
    current = nextTurn(current);
  }
  throw new Error(`the order never reached ${who}`);
};

/**
 * The named creature's **next** turn, which is a different thing.
 *
 * A caster who has just cast is still mid-turn, so `turnOf` hands their own
 * turn straight back — and a budget that has already paid for the casting is
 * not the one these fixtures are about.
 */
const nextTurnFor = (log: readonly GameEvent[], who: CharacterId): readonly GameEvent[] =>
  turnOf(nextTurn(log), who);

const castAt = (
  log: readonly GameEvent[],
  spellId: string,
  targets: readonly CharacterId[],
  slotLevel?: number,
) =>
  must(
    resolveSpell(
      fold('seed', log),
      CASTER,
      { spellId, targets: [...targets], ...(slotLevel === undefined ? {} : { slotLevel }) },
      supply(spellId),
    ),
  ).events;

// — the record ————————————————————————————————————————————————————————————

describe('a restriction is the ninth sourced grant', () => {
  it('lands on the creature with the casting in its source', () => {
    const log = [...SETUP, ...castAt(SETUP, 'binding-word', [TARGET], 1)];
    const state = fold('seed', log);

    const rules = state.creatures[TARGET]?.actionRules ?? [];
    expect(rules).toHaveLength(1);
    expect(rules[0]?.source).toMatch(/^Binding Word#cast:/);
    expect(rules[0]?.rule).toEqual({ kind: 'forbids', slots: ['action', 'bonus-action'] });
  });

  it('leaves a creature the spell never touched alone', () => {
    const log = [...SETUP, ...castAt(SETUP, 'binding-word', [TARGET], 1)];
    const state = fold('seed', log);

    expect(state.creatures[BYSTANDER]?.actionRules ?? []).toEqual([]);

    const theirTurn = fold('seed', turnOf(log, BYSTANDER));
    expect(whoseTurn(theirTurn)).toBe(BYSTANDER);
    // Not merely un-refused: the Dodge actually lands, action and all.
    const dodged = must(takeDodge(theirTurn, BYSTANDER, {}));
    expect(dodged.some((e) => e.type === 'action-spent')).toBe(true);
  });
});

// — a refusal worth reading ————————————————————————————————————————————————

describe('a forbidden action is refused as a value, naming what forbade it', () => {
  const held = () => {
    const log = [...SETUP, ...castAt(SETUP, 'binding-word', [TARGET], 1)];
    return { log: turnOf(log, TARGET), get state() { return fold('seed', this.log); } };
  };

  it('refuses the Action, saying what forbade it and until when', () => {
    const { state } = held();
    expect(whoseTurn(state)).toBe(TARGET);

    const refused = takeDodge(state, TARGET, {});
    expect(isErr(refused)).toBe(true);
    if (!isErr(refused)) return;
    expect(refused.code).toBe('action_forbidden');
    // The source **and** the deadline: `err('raging', …)` manages only the
    // first, and this sentence is the one a player actually reads.
    expect(refused.reason).toContain('Binding Word');
    expect(refused.reason).toContain('the spell ends');
    expect(refused.reason).toMatch(/action/i);
  });

  it('refuses a second Action-slot spender, so the guard is not one command deep', () => {
    const { state } = held();
    const refused = takeDash(state, TARGET, {});
    expect(isErr(refused) && refused.code).toBe('action_forbidden');
  });

  /**
   * **The Bonus Action, actually spent.**
   *
   * This test was titled "refuses a Bonus Action" and called `takeDash`,
   * which spends an Action — its own comment said it was reaching for a Bonus
   * Action spender and then did not. Every `action_forbidden` assertion in
   * the file was an Action-slot refusal, so deleting `refuseSpend` from
   * `spendBonusAction` left the suite green. A title claiming ground it does
   * not hold is worse than a missing test, because the next reader believes
   * it.
   */
  it('refuses a Bonus Action, through a spender that really spends one', () => {
    const { state } = held();
    const refused = resolveSpell(
      state,
      TARGET,
      { spellId: 'quick-spark', targets: [CASTER] },
      supply('spark'),
    );
    expect(isErr(refused) && refused.code).toBe('action_forbidden');
  });

  it('leaves movement alone, because the sentence does not name it', () => {
    const { state, log } = held();
    // SRD Stinking Cloud forbids an action and a Bonus Action and says
    // nothing about walking away, which is the whole reason a restriction
    // names slots rather than switching the creature off.
    const moved = resolveMove(
      state,
      TARGET,
      { placement: { from: { landmark: 'here' }, feet: 20, bearing: 180 } },
      supply('walk'),
    );
    expect(isErr(moved)).toBe(false);
    expect(log.length).toBeGreaterThan(0);
  });

  /**
   * SRD Slow: "it can't take Reactions."
   *
   * A Reaction is spent on somebody else's turn, so the hold is set up first
   * and released after the spell lands — which also proves the refusal is not
   * confined to the holder's own turn, the one way a Reaction differs from
   * every other spender.
   */
  it('refuses a Reaction, on a turn that is not the holder’s', () => {
    const readied = [
      ...turnOf(SETUP, TARGET),
      ...must(
        takeReady(
          fold('seed', turnOf(SETUP, TARGET)),
          TARGET,
          { trigger: 'anybody comes close', response: { kind: 'move' } },
          HOMEBREW,
        ),
      ),
    ];
    const casting = turnOf(readied, CASTER);
    const log = [...casting, ...castAt(casting, 'stilling-word', [TARGET], 1)];
    const state = fold('seed', log);
    expect(whoseTurn(state)).toBe(CASTER);

    const refused = releaseReady(state, TARGET, { placement: { from: { landmark: 'here' }, feet: 15, bearing: 90 } }, supply('rel'));
    expect(isErr(refused) && refused.code).toBe('action_forbidden');
  });

  /**
   * SRD Tsunami: "it can't move."
   *
   * The sentence the neighbouring fixture proves the *absence* of — Binding
   * Word leaves walking alone — said by a rule that names the slot. Without
   * both, "movement is only refused when the spell says so" is half a claim.
   */
  it('refuses movement when the rule names it', () => {
    const log = [...SETUP, ...castAt(SETUP, 'stilling-word', [TARGET], 1)];
    const state = fold('seed', turnOf(log, TARGET));
    const refused = resolveMove(
      state,
      TARGET,
      { placement: { from: { landmark: 'here' }, feet: 20, bearing: 180 } },
      supply('walk'),
    );
    expect(isErr(refused) && refused.code).toBe('action_forbidden');
  });

  /**
   * SRD Befuddlement: the target "can't cast spells or take the Magic action".
   *
   * **The named axis, with no slot forbidden at all.** Every other fixture
   * here bites through a slot, so mutating `forbids`\' action list to match
   * nothing left them all green. The pair of assertions is the test: the
   * Magic action is gone and the Action slot it would have come out of is
   * not.
   */
  it('refuses one named action and leaves the slot it came out of alone', () => {
    const log = [...SETUP, ...castAt(SETUP, 'befuddling-word', [TARGET], 1)];
    const state = fold('seed', turnOf(log, TARGET));

    const refused = resolveSpell(
      state,
      TARGET,
      { spellId: 'quick-spark', targets: [CASTER] },
      supply('spark'),
    );
    expect(isErr(refused) && refused.code).toBe('action_forbidden');

    // And the Action itself is untouched, which is the half a slot-shaped
    // rule could not say.
    expect(must(takeDodge(state, TARGET, {})).some((e) => e.type === 'action-spent')).toBe(true);
  });

  it('is a refusal and never an exception', () => {
    const { state } = held();
    expect(() => takeDodge(state, TARGET, {})).not.toThrow();
  });
});

// — the deadline ——————————————————————————————————————————————————————————

describe('a restriction ends through the machinery every timed effect uses', () => {
  /**
   * SRD Shocking Grasp: "can't make Opportunity Attacks **until the start of
   * its next turn**", on an Instantaneous cantrip. The rider's own deadline
   * is the only thing that could ever lift it.
   */
  it('lifts at the rider’s own deadline, on a casting that is already over', () => {
    const log = [...SETUP, ...castAt(SETUP, 'stilling-touch', [TARGET])];
    const during = fold('seed', log);
    expect(during.creatures[TARGET]?.actionRules ?? []).toHaveLength(1);

    // The casting left no ongoing record at all — it is Instantaneous — so
    // what holds the deadline is a `grants` timer and nothing else.
    expect(Object.keys(during.ongoing)).toEqual([]);
    expect(
      Object.values(during.timers).some(
        (t) => t.target.kind === 'grants' && t.target.on === TARGET,
      ),
    ).toBe(true);

    const after = fold('seed', turnOf(turnOf(log, TARGET), CASTER));
    expect(after.creatures[TARGET]?.actionRules ?? []).toEqual([]);
  });

  it('ends with the casting that made it', () => {
    const log = [...SETUP, ...castAt(SETUP, 'binding-word', [TARGET], 1)];
    const during = fold('seed', log);
    expect(during.creatures[TARGET]?.actionRules ?? []).toHaveLength(1);

    // A minute on the clock: the casting's own deadline, through
    // `releaseCasting` and the enumerator that walks all nine families.
    const later = applyEvent(during, { type: 'time-advanced', seconds: 60, reason: 'a minute' });
    expect(later.creatures[TARGET]?.actionRules ?? []).toEqual([]);
  });

  it('goes when Concentration drops', () => {
    const log = [...SETUP, ...castAt(SETUP, 'binding-word', [TARGET], 1)];
    const during = fold('seed', log);
    expect(during.creatures[TARGET]?.actionRules ?? []).toHaveLength(1);

    const dropped = applyAll(during, must(endConcentration(during, CASTER, 'voluntary')));
    expect(dropped.creatures[TARGET]?.actionRules ?? []).toEqual([]);
  });

  it('makes the same Action legal again once it has gone', () => {
    const log = [...SETUP, ...castAt(SETUP, 'binding-word', [TARGET], 1)];
    const onTheirTurn = turnOf(log, TARGET);
    expect(isErr(takeDodge(fold('seed', onTheirTurn), TARGET, {}))).toBe(true);

    const freed = [
      ...onTheirTurn,
      ...must(endConcentration(fold('seed', onTheirTurn), CASTER, 'voluntary')),
    ];
    const after = fold('seed', freed);
    expect(whoseTurn(after)).toBe(TARGET);
    const dodged = must(takeDodge(after, TARGET, {}));
    expect(dodged.some((e) => e.type === 'action-spent')).toBe(true);
  });
});

// — the compulsion —————————————————————————————————————————————————————————

describe('a compulsion is a fact about what is legal, not an instruction', () => {
  const compelled = () => {
    const log = [...SETUP, ...castAt(SETUP, 'harrying-word', [TARGET], 1)];
    return fold('seed', turnOf(log, TARGET));
  };

  it('refuses every Action but the one the spell named', () => {
    const state = compelled();
    const refused = takeDodge(state, TARGET, {});
    expect(isErr(refused) && refused.code).toBe('action_forbidden');
    if (isErr(refused)) expect(refused.reason).toContain('Dash');
  });

  it('permits the compelled Action, and never takes it for anybody', () => {
    const state = compelled();
    const dashed = must(takeDash(state, TARGET, {}));
    expect(dashed.some((e) => e.type === 'dash-taken')).toBe(true);

    // **Nothing happened until somebody asked.** The engine emitted no Dash
    // of its own when the spell landed, and emitted none at the boundary that
    // began this turn: a compelled turn with nobody at the table is a turn in
    // which nothing occurs, which is the whole of the doctrine here.
    const log = [...SETUP, ...castAt(SETUP, 'harrying-word', [TARGET], 1)];
    const upTo = turnOf(log, TARGET);
    expect(upTo.filter((e) => e.type === 'dash-taken')).toEqual([]);
    expect(upTo.filter((e) => e.type === 'movement-spent')).toEqual([]);
  });

  /**
   * **It fails closed, and that is the member rather than an accident.**
   *
   * The engine has no spender that can tell a Hide from a Search, so SRD Wind
   * Walk's "the only actions … are the Dash action, the Hide action, and the
   * Search action" can only be written as the part the engine adjudicates. A
   * spend out of the narrowed slot that does not name itself is therefore
   * *refused* rather than waved through — Ready is the one Action command
   * with no member of `NAMED_ACTIONS` to give — because letting an unnamed
   * spend past would silently permit exactly what the spell forbade.
   *
   * A mutation that flipped this to fail open left all the other fixtures
   * green, which is why the case is written down.
   */
  it('refuses an Action the engine cannot name, rather than waving it through', () => {
    const refused = takeReady(
      compelled(),
      TARGET,
      { trigger: 'anybody comes close', response: { kind: 'move' } },
      HOMEBREW,
    );
    expect(isErr(refused) && refused.code).toBe('action_forbidden');
  });

  it('says nothing about the Bonus Action, because the sentence does not', () => {
    // SRD Fear narrows the *Action*. A `permits-only` on one slot leaves the
    // other slots exactly as it found them, which is what keeps it a rule
    // about a sentence rather than a second Incapacitated.
    const rules = compelled().creatures[TARGET]?.actionRules ?? [];
    expect(rules[0]?.rule).toEqual({ kind: 'permits-only', slot: 'action', actions: ['dash'] });
  });
});

// — the allowance ——————————————————————————————————————————————————————————

describe('a spell may widen what a turn permits as well as narrow it', () => {
  /**
   * SRD Conjure Woodland Beings: "you can take the Disengage action as a Bonus
   * Action for the spell's duration."
   *
   * The caller asks for the cheaper price and the engine rules on whether they
   * may have it — the same direction every other rule here runs in.
   */
  it('refuses the cheaper price when no spell has granted it', () => {
    const state = fold('seed', SETUP);
    const refused = takeDisengage(state, CASTER, {}, { from: 'bonus-action' });
    expect(isErr(refused) && refused.code).toBe('action_not_allowed');
  });

  /**
   * A price this command has no spender for is refused rather than rounded to
   * the ordinary one. It used to fall through the ternary and take the
   * caller's **Action** — the substitution `DisengageOptions` says it never
   * makes — and a caller may state a price with no definition anywhere in it,
   * so the door checks as well as the validator.
   */
  it.each(['reaction', 'movement'] as const)('refuses a price it cannot charge: %s', (from) => {
    const refused = takeDisengage(fold('seed', SETUP), CASTER, {}, { from });
    expect(isErr(refused) && refused.code).toBe('no_such_price');
  });

  /**
   * A round later, because casting it spent the Action — and the benefit is
   * precisely that the *next* turn's Action survives the Disengage.
   */
  const running = (): GameState =>
    fold('seed', nextTurnFor([...SETUP, ...castAt(SETUP, 'nimble-step', [CASTER], 1)], CASTER));

  it('permits it while the spell runs, out of the Bonus Action', () => {
    const state = running();

    const taken = must(takeDisengage(state, CASTER, {}, { from: 'bonus-action' }));
    expect(taken.some((e) => e.type === 'bonus-action-spent')).toBe(true);
    expect(taken.some((e) => e.type === 'action-spent')).toBe(false);

    // And the Action is still there to spend on something else, which is the
    // whole benefit the sentence confers.
    const after = applyAll(state, taken);
    expect(after.combat?.budgets[CASTER]?.action).toBe(true);
    expect(after.combat?.budgets[CASTER]?.bonusAction).toBe(false);
  });

  it('still charges the Action when the caller does not ask for the price', () => {
    const taken = must(takeDisengage(running(), CASTER, {}));
    expect(taken.some((e) => e.type === 'action-spent')).toBe(true);
    expect(taken.some((e) => e.type === 'bonus-action-spent')).toBe(false);
  });

  it('takes the allowance back with the casting', () => {
    const log = [...SETUP, ...castAt(SETUP, 'nimble-step', [CASTER], 1)];
    const during = fold('seed', log);
    const ended = applyAll(during, must(endConcentration(during, CASTER, 'voluntary')));
    expect(ended.creatures[CASTER]?.actionRules ?? []).toEqual([]);
    expect(isErr(takeDisengage(ended, CASTER, {}, { from: 'bonus-action' }))).toBe(true);
  });
});

// — the definition format ——————————————————————————————————————————————————

describe('the validator holds the vocabulary', () => {
  const bad = (effect: unknown): readonly string[] =>
    checkSpellDefinitionValue({
      id: 'x',
      name: 'X',
      level: 1,
      school: 'evocation',
      castingTime: 'action',
      concentration: false,
      durationSeconds: 60,
      range: { kind: 'ranged', feet: 30 },
      targets: { count: 1 },
      effects: [effect],
    }).map((p) => p.code);

  it('refuses a rule that names nothing', () => {
    expect(bad({ kind: 'action-rule', rule: { kind: 'forbids' } })).toContain('bad_action_rule');
  });

  it('refuses a slot the action economy does not have', () => {
    expect(bad({ kind: 'action-rule', rule: { kind: 'forbids', slots: ['ki'] } })).toContain(
      'bad_action_rule',
    );
  });

  it('refuses an action the engine cannot recognise at a spender', () => {
    expect(
      bad({ kind: 'action-rule', rule: { kind: 'permits-only', slot: 'action', actions: ['sing'] } }),
    ).toContain('bad_action_rule');
  });

  /**
   * The two guards that keep the vocabulary from saying what nothing reads —
   * this repository's most-repeated finding, pointed at its own new members.
   */
  it('refuses an allowance no command could ever honour', () => {
    expect(
      bad({ kind: 'action-rule', rule: { kind: 'allows', action: 'dash', from: 'bonus-action' } }),
    ).toContain('bad_action_rule');
  });

  /**
   * **The slot, not only the action.** This validated while the guard was a
   * list of action names, and `takeDisengage` then fell through its ternary
   * and spent an Action — the quiet substitution its options type promises
   * never to make. `STATABLE_PRICES` is a map of pairs for that reason.
   */
  it.each(['reaction', 'movement'])('refuses an allowance to pay out of %s', (from) => {
    expect(
      bad({ kind: 'action-rule', rule: { kind: 'allows', action: 'disengage', from } }),
    ).toContain('bad_action_rule');
  });

  it('refuses a slot narrowed to a few when nothing is ever named in it', () => {
    // Narrowing movement can only mean forbidding it, which `forbids` says.
    expect(
      bad({ kind: 'action-rule', rule: { kind: 'permits-only', slot: 'movement', actions: [] } }),
    ).toContain('bad_action_rule');
  });

  it('refuses an allowance that costs what it already costs', () => {
    expect(
      bad({ kind: 'action-rule', rule: { kind: 'allows', action: 'disengage', from: 'action' } }),
    ).toContain('bad_action_rule');
  });

  /**
   * The rule `checkGrantLifetimes` applies to every other sourced grant: a
   * casting that is over the instant it resolves has nothing that could take
   * the restriction off again.
   */
  it('refuses a rider on an Instantaneous casting with no deadline of its own', () => {
    const codes = checkSpellDefinition({
      id: 'y',
      name: 'Y',
      level: 0,
      school: 'evocation',
      castingTime: 'action',
      concentration: false,
      range: { kind: 'touch' },
      targets: { count: 1 },
      effects: [
        {
          kind: 'attack',
          attack: 'melee',
          damage: { dice: '1d8' },
          damageType: 'lightning',
          modifiers: [{ kind: 'action', rule: { kind: 'forbids', slots: ['reaction'] } }],
        },
      ],
    }).map((p) => p.code);
    expect(codes).toContain('grant_without_lifetime');
  });

  it('accepts the four the fixtures above are written with', () => {
    for (const json of [BINDING_WORD, STILLING_TOUCH, HARRYING_WORD, NIMBLE_STEP]) {
      expect(checkSpellDefinition(JSON.parse(json))).toEqual([]);
    }
  });
});

// — determinism ————————————————————————————————————————————————————————————

describe('the whole of it replays byte-identically', () => {
  it('folds to the same state twice from one seed', () => {
    let log: readonly GameEvent[] = [...SETUP, ...castAt(SETUP, 'binding-word', [TARGET], 1)];
    log = turnOf(log, TARGET);
    log = [...log, ...must(endConcentration(fold('seed', log), CASTER, 'voluntary'))];
    log = turnOf(log, CASTER);
    log = [...log, ...castAt(log, 'nimble-step', [CASTER], 2)];

    expect(JSON.stringify(fold('seed', log))).toEqual(JSON.stringify(fold('seed', log)));
    expect(fold('seed', log).creatures[CASTER]?.actionRules).toHaveLength(1);
  });
});
