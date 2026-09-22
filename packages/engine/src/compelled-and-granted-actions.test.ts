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
import { checkSpellDefinitionValue } from './spell-schema.js';
import {
  endConcentration,
  releaseReady,
  resolveSpell,
  resolveTurn,
  takeDash,
  takeDisengage,
  takeDodge,
  takeReady,
} from './commands.js';

/**
 * The two arms of `an-action-a-spell-compels-or-forbids` gate G1 read apart
 * and nobody had built: an action a running effect **creates**, and a slot of
 * somebody else's turn a spell **spends**.
 *
 * `ActionRule` said three things — a slot taken away, a slot narrowed, a named
 * action re-priced — and every one of them is a fact about what is *legal*.
 * Two SRD sentences are neither:
 *
 * > Haste: "it gains an **additional action** on each of its turns." — a
 * > fourth member, `grants`, and a turn boundary that mints one every turn the
 * > casting sees.
 *
 * > Expeditious Retreat: "**You take the Dash action**, and until the spell
 * > ends, you can take that action again as a Bonus Action." — the same
 * > member at the other moment, narrowed to the one action the sentence names.
 *
 * > Dissonant Whispers: "it must immediately **use its Reaction**, if
 * > available, to move as far away from you as it can." — a slot of the
 * > target's own turn, used up by the spell.
 *
 * **The engine still plays nobody.** A granted action is offered and never
 * taken: a turn on which the table narrates nothing is a turn on which nothing
 * happened. A compelled Reaction is *charged* and never performed — the log
 * says the slot went and what the book says it went on, and the fleeing is the
 * table's. That is the line the owner's ruling moved and the line it left
 * where it was: a spell may spend another creature's budget, and no caller
 * may, because the only door onto `budget-compelled` is a casting's resolver.
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
 * SRD Haste's second sentence: "it gains an additional action on each of its
 * turns."
 *
 * The narrowing that follows it is not here and could not be: the five actions
 * the book lists include Utilize, which `NAMED_ACTIONS` leaves out because no
 * spender could be told apart as having taken one. So the fixture grants the
 * action the sentence grants and says nothing it cannot enforce.
 */
const QUICKENING = JSON.stringify({
  id: 'quickening',
  name: 'Quickening',
  level: 3,
  school: 'transmutation',
  castingTime: 'action',
  concentration: true,
  durationSeconds: 60,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1 },
  effects: [{ kind: 'action-rule', rule: { kind: 'grants', at: 'each-turn' } }],
});

/**
 * SRD Expeditious Retreat's first clause: "You take the Dash action."
 *
 * The same member at the other moment — once, as the casting resolves — and
 * narrowed to the one action the sentence names, because an unnarrowed extra
 * action would buy the caster a free Attack the book never offered.
 */
const FLEET_STEP = JSON.stringify({
  id: 'fleet-step',
  name: 'Fleet Step',
  level: 1,
  school: 'transmutation',
  castingTime: 'bonus-action',
  concentration: true,
  durationSeconds: 600,
  range: { kind: 'self' },
  targets: { count: 1, self: true },
  effects: [
    { kind: 'action-rule', rule: { kind: 'grants', at: 'casting', only: ['dash'] } },
    { kind: 'action-rule', rule: { kind: 'allows', action: 'dash', from: 'bonus-action' } },
  ],
});

/**
 * SRD Dissonant Whispers, whole: a save, damage on both branches, and a
 * Reaction the failure spends.
 */
const CRUEL_WHISPER = JSON.stringify({
  id: 'cruel-whisper',
  name: 'Cruel Whisper',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  effects: [
    {
      kind: 'save-damage',
      ability: 'wis',
      damage: { dice: '3d6' },
      damageType: 'psychic',
      onSuccess: 'half',
      spends: {
        slots: ['reaction'],
        on: 'moving as far away from the caster as it can, by the safest route',
      },
    },
  ],
});

/** A rule that takes the Reaction away, so "if available" has something to hit. */
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
  effects: [{ kind: 'action-rule', rule: { kind: 'forbids', slots: ['reaction'] } }],
});

const HOMEBREW = unwrap(
  loadContent({
    spells: [
      JSON.parse(QUICKENING),
      JSON.parse(FLEET_STEP),
      JSON.parse(CRUEL_WHISPER),
      JSON.parse(STILLING_WORD),
    ],
  }),
  'load',
);

const PREPARED = ['quickening', 'fleet-step', 'cruel-whisper', 'stilling-word'];

const PLACED: readonly GameEvent[] = [
  added(CASTER),
  added(TARGET, { abilities: FRAIL }),
  added(BYSTANDER, { abilities: FRAIL }),
  ...[1, 2, 3].map(
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
    spellcasting: declaredCasting({ ability: 'int', cantrips: [], prepared: PREPARED }),
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

const must = <T,>(result: Result<T>): T => unwrap(result, 'granted and compelled actions');

const applyAll = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce(applyEvent, state);

const nextTurn = (log: readonly GameEvent[]): readonly GameEvent[] => [
  ...log,
  ...must(resolveTurn(fold('seed', log), supply('turn'))).events,
];

const whoseTurn = (state: GameState): CharacterId | undefined =>
  state.combat?.order[state.combat.turnIndex]?.id;

const turnOf = (log: readonly GameEvent[], who: CharacterId): readonly GameEvent[] => {
  let current = log;
  for (let i = 0; i < 12; i += 1) {
    if (whoseTurn(fold('seed', current)) === who) return current;
    current = nextTurn(current);
  }
  throw new Error(`the order never reached ${who}`);
};

/**
 * The named creature's **next** turn, which is a different thing: a caster who
 * has just cast is still mid-turn, and `turnOf` would hand that turn back.
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

const budgetOf = (state: GameState, who: CharacterId) => state.combat?.budgets[who];

// — an action a running effect creates ————————————————————————————————————

describe('an extra action a casting grants each turn', () => {
  const hastened = () => [...SETUP, ...castAt(SETUP, 'quickening', [TARGET], 3)];

  it('hangs the rule on the creature with the casting in its source', () => {
    const state = fold('seed', hastened());
    const rules = state.creatures[TARGET]?.actionRules ?? [];
    expect(rules).toHaveLength(1);
    expect(rules[0]?.source).toMatch(/^Quickening#cast:/);
    expect(rules[0]?.rule).toEqual({ kind: 'grants', at: 'each-turn' });
  });

  /**
   * **It mints nothing where it stands.** The rule is on the creature; the
   * budget is the turn's, and only a combat event writes one — which is the
   * whole reason the boundary is where this happens.
   */
  it('adds nothing to the turn it was cast on', () => {
    const state = fold('seed', hastened());
    expect(budgetOf(state, TARGET)?.extraActions ?? []).toEqual([]);
  });

  it('mints one at the start of the target’s turn, and says what bought it', () => {
    const log = turnOf(hastened(), TARGET);
    const state = fold('seed', log);
    expect(whoseTurn(state)).toBe(TARGET);
    expect(budgetOf(state, TARGET)?.extraActions).toEqual([{ source: 'Quickening' }]);
  });

  /** Two Actions in one turn, which is the whole of what the sentence buys. */
  it('lets the turn spend an Action twice', () => {
    const log = turnOf(hastened(), TARGET);
    const first = applyAll(fold('seed', log), must(takeDodge(fold('seed', log), TARGET, {})));
    expect(first.combat?.budgets[TARGET]?.action).toBe(false);

    const second = must(takeDash(first, TARGET, {}));
    expect(second.some((e) => e.type === 'dash-taken')).toBe(true);

    const spent = applyAll(first, second);
    expect(spent.combat?.budgets[TARGET]?.extraActions ?? []).toEqual([]);

    // And a third is the ordinary refusal: the spell added one, not a slot
    // that refills.
    expect(isErr(takeDodge(spent, TARGET, {}))).toBe(true);
  });

  /**
   * **One a turn and never two.** An unspent extra action goes with the turn
   * it was granted for; a boundary that added without the budget being reset
   * would hand a hasted creature a second one every round it did not act.
   */
  it('does not accumulate across turns', () => {
    const second = turnOf(turnOf(hastened(), TARGET), TARGET);
    expect(budgetOf(fold('seed', second), TARGET)?.extraActions).toEqual([
      { source: 'Quickening' },
    ]);
  });

  it('stops the moment the casting does', () => {
    const log = hastened();
    const dropped = [
      ...log,
      ...must(endConcentration(fold('seed', log), CASTER, 'voluntary')),
    ];
    expect(fold('seed', dropped).creatures[TARGET]?.actionRules ?? []).toEqual([]);

    const later = turnOf(dropped, TARGET);
    expect(budgetOf(fold('seed', later), TARGET)?.extraActions ?? []).toEqual([]);
  });

  it('leaves a creature the casting never touched alone', () => {
    const log = turnOf(hastened(), BYSTANDER);
    expect(budgetOf(fold('seed', log), BYSTANDER)?.extraActions ?? []).toEqual([]);
  });
});

// — the same member, at the casting ————————————————————————————————————————

describe('an extra action a casting hands over once, narrowed to what it names', () => {
  const fleet = () => {
    const onTheirTurn = turnOf(SETUP, CASTER);
    return [...onTheirTurn, ...castAt(onTheirTurn, 'fleet-step', [CASTER], 1)];
  };

  it('adds it to the turn the casting resolved on', () => {
    const state = fold('seed', fleet());
    expect(budgetOf(state, CASTER)?.extraActions).toEqual([
      { source: 'Fleet Step', only: ['dash'] },
    ]);
  });

  it('hangs no standing rule for it, because there is nothing left to lift', () => {
    const rules = fold('seed', fleet()).creatures[CASTER]?.actionRules ?? [];
    expect(rules.map((r) => r.rule.kind)).toEqual(['allows']);
  });

  /** The action the sentence names is the one it buys, and nothing else is. */
  it('spends on the named action and refuses every other, naming what bought it', () => {
    const state = fold('seed', fleet());
    // The Action slot is still the caster's own — Fleet Step cost a Bonus
    // Action — so the refusal has to come from the *extra* one, which means
    // spending the turn's own first.
    const spentOwn = applyAll(state, must(takeDodge(state, CASTER, {})));
    expect(spentOwn.combat?.budgets[CASTER]?.action).toBe(false);

    const refused = takeDisengage(spentOwn, CASTER, {});
    expect(isErr(refused) && refused.code).toBe('action_forbidden');
    if (isErr(refused)) expect(refused.reason).toContain('Fleet Step');

    const dashed = must(takeDash(spentOwn, CASTER, {}));
    expect(dashed.some((e) => e.type === 'dash-taken')).toBe(true);
  });

  it('is granted once and not again at the next boundary', () => {
    const later = nextTurnFor(fleet(), CASTER);
    expect(budgetOf(fold('seed', later), CASTER)?.extraActions ?? []).toEqual([]);
  });

  /**
   * **No turn, no extra action, and no refusal either.** A casting outside a
   * fight adds to nothing, exactly as a pool purchase would — but a spell is
   * not a purchase and the rest of it must still land, so this is silence
   * rather than `not_in_combat`.
   */
  it('adds nothing outside combat, and does not refuse the casting', () => {
    const events = must(
      resolveSpell(
        fold('seed', PLACED),
        CASTER,
        { spellId: 'fleet-step', targets: [CASTER], slotLevel: 1 },
        supply('fleet'),
      ),
    ).events;
    expect(events.some((e) => e.type === 'turn-budget-granted')).toBe(false);
    expect(events.some((e) => e.type === 'action-rule-granted')).toBe(true);
  });
});

// — a slot of somebody else's turn, spent ——————————————————————————————————

describe('a spell spends the target’s own budget', () => {
  /** The target readies on their turn, so there is a Reaction to lose. */
  const whispered = () => {
    const casting = turnOf(SETUP, CASTER);
    return [...casting, ...castAt(casting, 'cruel-whisper', [TARGET], 1)];
  };

  it('takes the Reaction, and says in the log what the book says it went on', () => {
    const log = whispered();
    const compelled = log.filter((e) => e.type === 'budget-compelled');
    expect(compelled).toHaveLength(1);
    expect(compelled[0]).toMatchObject({
      id: TARGET,
      slot: 'reaction',
      on: 'moving as far away from the caster as it can, by the safest route',
    });
    expect(budgetOf(fold('seed', log), TARGET)?.reaction).toBe(false);
  });

  /** And the Reaction is actually gone: a readied response cannot be released. */
  it('leaves the target with no Reaction to spend', () => {
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
    const log = [...casting, ...castAt(casting, 'cruel-whisper', [TARGET], 1)];

    const refused = releaseReady(
      fold('seed', log),
      TARGET,
      { placement: { from: { landmark: 'here' }, feet: 15, bearing: 90 } },
      supply('rel'),
    );
    expect(isErr(refused) && refused.code).toBe('no_reaction');
  });

  /** "if available" — a Reaction already gone is not a refusal of the spell. */
  it('spends nothing when the slot is already gone, and the damage still lands', () => {
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
    // The target spends its own Reaction on its own readied move, which is the
    // world the book's "if available" is asked about.
    const released = [
      ...casting,
      ...must(
        releaseReady(
          fold('seed', casting),
          TARGET,
          { placement: { from: { landmark: 'here' }, feet: 15, bearing: 90 } },
          supply('rel'),
        ),
      ).events,
    ];
    const log = [...released, ...castAt(released, 'cruel-whisper', [TARGET], 1)];

    expect(log.filter((e) => e.type === 'budget-compelled')).toEqual([]);
    expect(log.some((e) => e.type === 'damage-taken')).toBe(true);
  });

  /**
   * **A rule that took the Reaction away wins.** SRD Slow's "it can't take
   * Reactions" is a legality, and a spell that spends a budget spends one the
   * creature could have used — the same `refuseSpend` every caller meets.
   */
  it('spends nothing the target was already forbidden', () => {
    const casting = turnOf(SETUP, CASTER);
    const stilled = [...casting, ...castAt(casting, 'stilling-word', [TARGET], 1)];
    // SRD: "On a turn, you can expend only one spell slot to cast a spell", so
    // the second casting is a round later — by which time the target's own turn
    // has refreshed the Reaction the rule is standing over.
    const round = nextTurnFor(stilled, CASTER);
    const log = [...round, ...castAt(round, 'cruel-whisper', [TARGET], 1)];

    expect(log.filter((e) => e.type === 'budget-compelled')).toEqual([]);
    expect(budgetOf(fold('seed', log), TARGET)?.reaction).toBe(true);
  });

  it('spends nothing outside a fight, and still deals the damage', () => {
    const events = must(
      resolveSpell(
        fold('seed', PLACED),
        CASTER,
        { spellId: 'cruel-whisper', targets: [TARGET], slotLevel: 1 },
        supply('whisper'),
      ),
    ).events;
    expect(events.some((e) => e.type === 'budget-compelled')).toBe(false);
    expect(events.some((e) => e.type === 'damage-taken')).toBe(true);
  });

  /**
   * **It charges and never performs.** The doctrine's line held: nothing moved
   * the target, nothing was readied on its behalf, and what the book says the
   * Reaction went on is a phrase in the log for the table to narrate from.
   */
  it('makes nobody move', () => {
    const log = whispered();
    expect(log.filter((e) => e.type === 'movement-spent')).toEqual([]);
    expect(log.filter((e) => e.type === 'ready-taken')).toEqual([]);
  });

  /** The casting is in the source, so a log can say which spell took the slot. */
  it('names the casting that spent it', () => {
    const compelled = whispered().filter((e) => e.type === 'budget-compelled');
    expect(compelled[0]).toMatchObject({ source: expect.stringMatching(/^Cruel Whisper#cast:/) });
  });
});

// — what the validator will not accept ————————————————————————————————————

describe('the vocabulary is held at authoring', () => {
  const problems = (effects: unknown) =>
    checkSpellDefinitionValue({
        id: 'probe',
        name: 'Probe',
        level: 1,
        school: 'enchantment',
        castingTime: 'action',
        concentration: true,
        durationSeconds: 60,
        range: { kind: 'ranged', feet: 30 },
        targets: { count: 1 },
      effects,
    });

  it('refuses a grant that says nothing about when the turn gets it', () => {
    const found = problems([{ kind: 'action-rule', rule: { kind: 'grants' } }]);
    expect(found.some((p) => p.code === 'bad_action_rule')).toBe(true);
  });

  it('refuses a grant narrowed to nothing at all', () => {
    const found = problems([
      { kind: 'action-rule', rule: { kind: 'grants', at: 'each-turn', only: [] } },
    ]);
    expect(found.some((p) => p.code === 'bad_action_rule')).toBe(true);
  });

  it('refuses a grant narrowed to an action no spender can tell apart', () => {
    const found = problems([
      { kind: 'action-rule', rule: { kind: 'grants', at: 'casting', only: ['utilize'] } },
    ]);
    expect(found.some((p) => p.code === 'bad_action_rule')).toBe(true);
  });

  it('refuses a spend of movement, which is measured in feet and not in slots', () => {
    const found = problems([
      {
        kind: 'save-damage',
        ability: 'wis',
        damage: { dice: '1d6' },
        damageType: 'psychic',
        onSuccess: 'none',
        spends: { slots: ['movement'], on: 'running' },
      },
    ]);
    expect(found.some((p) => p.code === 'bad_budget_spend')).toBe(true);
  });

  it('refuses a spend that says nothing about what it went on', () => {
    const found = problems([
      {
        kind: 'save-damage',
        ability: 'wis',
        damage: { dice: '1d6' },
        damageType: 'psychic',
        onSuccess: 'none',
        spends: { slots: ['reaction'] },
      },
    ]);
    expect(found.some((p) => p.code === 'bad_budget_spend')).toBe(true);
  });

  it('refuses a spend of no slot at all', () => {
    const found = problems([
      {
        kind: 'save-damage',
        ability: 'wis',
        damage: { dice: '1d6' },
        damageType: 'psychic',
        onSuccess: 'none',
        spends: { slots: [], on: 'nothing' },
      },
    ]);
    expect(found.some((p) => p.code === 'bad_budget_spend')).toBe(true);
  });
});
