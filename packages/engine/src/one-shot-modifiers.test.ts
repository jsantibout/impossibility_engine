import { readFileSync } from 'node:fs';
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
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { rollModifierKey, selectorMatches, type RollSelector } from './roll-modifiers.js';
import { checkSpellDefinition, ROLL_FAMILIES } from './spell-schema.js';
import { checkContent } from './content.js';
import type { CatalogueItem } from './catalogue.js';
import { resolveAttack, resolveSpell, resolveTurn } from './commands.js';
import type { SpellDefinition } from './spell-definitions.js';

/**
 * A roll modifier consumed by the roll it changes.
 *
 * SRD writes two of these and means the same mechanic both times, from the two
 * ends a `RollRelation` already distinguishes:
 *
 * > Guiding Bolt: "the **next attack roll made against it** before the end of
 * > your next turn has Advantage."
 * > Vicious Mockery: "have Disadvantage on the **next attack roll it makes**
 * > before the end of its next turn."
 *
 * A durable grant runs until its casting ends, so neither sentence could be
 * written: both name a roll that *spends* the grant. The half that was missing
 * is one event whose fold body is the `releaseGrants` call a `grants` deadline
 * already makes, emitted by the rolling command beside `roll-recorded`.
 *
 * **Both endings, and the deadline is not the interesting one.** Each sentence
 * names a moment as well as a roll, and that half already had its door — the
 * `grants` timer matching the bare source. What is new here is the first half,
 * and the case that separates a correct implementation from a plausible one is
 * a roll that came out **normal**: `modes` keeps the sources that cancelled, so
 * the rule is "the next attack roll it makes" and not "the next one it
 * changed".
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const TARGET = id('target');
const OTHER = id('other');
/** Placed, visible and targetable — and not in the initiative order. */
const LATECOMER = id('latecomer');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 11,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 20 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'cha',
  ...over,
});

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 300,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

/** A Wisdom of 1 against a Charisma-20 DC: this target fails every save. */
const FRAIL = { str: 10, dex: 10, con: 10, int: 10, wis: 1, cha: 10 } as const;

const slots: readonly GameEvent[] = [1].map((level) => ({
  type: 'resource-pool-declared',
  id: CASTER,
  pool: {
    key: spellSlotKey(level),
    label: `level ${level} spell slot`,
    max: 4,
    recovers: 'long-rest',
  },
}));

const PLACED: readonly GameEvent[] = [
  added(CASTER),
  added(TARGET, { abilities: FRAIL }),
  added(OTHER, { abilities: FRAIL }),
  added(LATECOMER, { abilities: FRAIL }),
  ...slots,
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({
      ability: 'cha',
      cantrips: ['vicious-mockery', 'fire-bolt'],
      prepared: ['guiding-bolt'],
    }),
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'here', at: { x: 100, y: 100, z: 0 } },
  { type: 'landmark-added', name: 'there', at: { x: 105, y: 100, z: 0 } },
  { type: 'landmark-added', name: 'beside', at: { x: 105, y: 105, z: 0 } },
  { type: 'landmark-added', name: 'the doorway', at: { x: 100, y: 105, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'here' }, feet: 0 } },
  { type: 'creature-placed', id: TARGET, placement: { from: { landmark: 'there' }, feet: 0 } },
  { type: 'creature-placed', id: OTHER, placement: { from: { landmark: 'beside' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: LATECOMER,
    placement: { from: { landmark: 'the doorway' }, feet: 0 },
  },
  { type: 'sight-declared', from: CASTER, to: LATECOMER, seen: true },
  { type: 'sight-declared', from: CASTER, to: TARGET, seen: true },
  { type: 'sight-declared', from: CASTER, to: OTHER, seen: true },
  { type: 'sight-declared', from: TARGET, to: CASTER, seen: true },
  { type: 'sight-declared', from: TARGET, to: OTHER, seen: true },
  { type: 'sight-declared', from: OTHER, to: TARGET, seen: true },
];

/** The caster acts first, so "your next turn" and "its next turn" differ. */
const SETUP: readonly GameEvent[] = [
  ...PLACED,
  {
    type: 'combat-started',
    combatants: [
      { id: CASTER, initiative: 20, speed: 30 },
      { id: TARGET, initiative: 10, speed: 30 },
      { id: OTHER, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>): T => unwrap(result, 'one-shot modifiers');

const applyAll = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce(applyEvent, state);

const nextTurn = (log: readonly GameEvent[]): readonly GameEvent[] => [
  ...log,
  ...must(resolveTurn(fold('seed', log), supply('turn'))).events,
];

const whoseTurn = (state: GameState) => state.combat?.order[state.combat.turnIndex]?.id;

const modifiersOn = (state: GameState, who: CharacterId) =>
  state.creatures[who]?.rollModifiers ?? [];

/**
 * Cast Vicious Mockery at the target, which has a Wisdom of 1 and fails.
 *
 * A cantrip, so nothing is spent and the casting is over the instant it
 * resolves: the Disadvantage it leaves behind has no casting that could ever
 * take it off, which is what the rider's own `lasts` is for.
 */
const mock = (log: readonly GameEvent[]) =>
  must(
    resolveSpell(
      fold('seed', log),
      CASTER,
      { spellId: 'vicious-mockery', targets: [TARGET] },
      supply('mock'),
    ),
  ).events;

const swing = (
  state: GameState,
  attacker: CharacterId,
  at: CharacterId,
  modes?: readonly { readonly source: string; readonly mode: 'advantage' | 'disadvantage' }[],
) =>
  resolveAttack(
    state,
    attacker,
    { target: at, weapon: null, free: true, ...(modes === undefined ? {} : { modes }) },
    supply(`swing:${attacker}:${at}`),
  );

describe('Vicious Mockery is spent by the next attack the target makes', () => {
  it('hangs a one-shot Disadvantage on the target', () => {
    const before = fold('seed', SETUP);
    const after = applyAll(before, mock(SETUP));

    const held = modifiersOn(after, TARGET);
    expect(held).toHaveLength(1);
    expect(held[0]?.modifier.mode).toBe('disadvantage');
    expect(held[0]?.modifier.selector).toMatchObject({ roll: 'attack', relation: 'roller' });
    expect(held[0]?.modifier.oneShot).toBe(true);
  });

  it('reaches the target’s next attack roll and is gone from the one after', () => {
    let log: readonly GameEvent[] = [...SETUP, ...mock(SETUP)];
    log = nextTurn(log);
    const theirs = fold('seed', log);
    expect(whoseTurn(theirs)).toBe(TARGET);

    const first = must(swing(theirs, TARGET, CASTER));
    expect(first.attack?.roll.mode).toBe('disadvantage');

    const spent = applyAll(theirs, first.events);
    expect(modifiersOn(spent, TARGET)).toEqual([]);

    const second = must(swing(spent, TARGET, CASTER));
    expect(second.attack?.roll.mode).toBe('normal');
  });

  /**
   * **The case that is the whole difference.** A roll that came out `normal`
   * because two rulings cancelled is still "the next attack roll it makes",
   * and a reading that consumed only what it *changed* would leave the
   * Disadvantage standing for the swing after — a second bite from one
   * sentence.
   */
  it('is spent by a roll that cancellation brought back to normal', () => {
    let log: readonly GameEvent[] = [...SETUP, ...mock(SETUP)];
    log = nextTurn(log);
    const theirs = fold('seed', log);

    const cancelled = must(
      swing(theirs, TARGET, CASTER, [{ source: 'the high ground', mode: 'advantage' }]),
    );
    expect(cancelled.attack?.roll.mode).toBe('normal');

    const spent = applyAll(theirs, cancelled.events);
    expect(modifiersOn(spent, TARGET)).toEqual([]);
  });

  /**
   * SRD: "before the end of its next turn" — the **target's** turn, not the
   * caster's, which is why the rider names a target-anchored moment. An
   * unconsumed grant ends there through the `grants` timer, with no second
   * lifecycle and no event of its own.
   */
  it('ends at the deadline when no attack ever spends it', () => {
    let log: readonly GameEvent[] = [...SETUP, ...mock(SETUP)];
    expect(modifiersOn(fold('seed', log), TARGET)).toHaveLength(1);

    // The caster's turn ends, the target's turn comes and goes, and the
    // grant is still there through the whole of it: "the next attack roll it
    // makes **before the end of its next turn**".
    log = nextTurn(log);
    expect(whoseTurn(fold('seed', log))).toBe(TARGET);
    expect(modifiersOn(fold('seed', log), TARGET)).toHaveLength(1);

    log = nextTurn(log);
    expect(modifiersOn(fold('seed', log), TARGET)).toEqual([]);
  });

  it('spends nothing when somebody else swings', () => {
    let log: readonly GameEvent[] = [...SETUP, ...mock(SETUP)];
    log = nextTurn(log);
    const theirs = fold('seed', log);

    const elsewhere = must(swing(theirs, CASTER, OTHER));
    expect(modifiersOn(applyAll(theirs, elsewhere.events), TARGET)).toHaveLength(1);
  });
});

describe('Guiding Bolt is spent by the next attack made against the target', () => {
  /**
   * SRD Guiding Bolt is a ranged spell attack, and the fixture needs it to
   * hit: a seed is chosen once and the test says so rather than asserting a
   * number the engine rolled.
   */
  const bolt = (log: readonly GameEvent[], seed: string) =>
    must(
      resolveSpell(
        fold('seed', log),
        CASTER,
        { spellId: 'guiding-bolt', targets: [TARGET], slotLevel: 1 },
        supply(seed),
      ),
    );

  const hitting = (log: readonly GameEvent[]) => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const cast = bolt(log, seed);
      if (cast.events.some((e) => e.type === 'roll-modifier-granted')) return cast.events;
    }
    throw new Error('no seed in the list landed a Guiding Bolt');
  };

  it('hangs a one-shot Advantage on rolls against the target', () => {
    const before = fold('seed', SETUP);
    const after = applyAll(before, hitting(SETUP));

    const held = modifiersOn(after, TARGET);
    expect(held).toHaveLength(1);
    expect(held[0]?.modifier.mode).toBe('advantage');
    expect(held[0]?.modifier.selector).toMatchObject({
      roll: 'attack',
      relation: 'against-holder',
    });
    expect(held[0]?.modifier.oneShot).toBe(true);
  });

  it('lifts one attack against the target and no more', () => {
    const log: readonly GameEvent[] = [...SETUP, ...hitting(SETUP)];
    const state = fold('seed', log);

    const first = must(swing(state, CASTER, TARGET));
    expect(first.attack?.roll.mode).toBe('advantage');

    const spent = applyAll(state, first.events);
    expect(modifiersOn(spent, TARGET)).toEqual([]);

    // And it was the *next* roll against the target whoever made it: a third
    // creature's swing finds nothing left.
    const second = must(swing(spent, OTHER, TARGET));
    expect(second.attack?.roll.mode).toBe('normal');
  });

  /**
   * **A spell attack is an attack roll**, which the resolver asserts in a
   * comment and this is what holds it to. The grant is Guiding Bolt's own and
   * the roll that spends it is a Fire Bolt: the emitter in
   * `spell-effect-rolls.ts` is a second copy of the weapon attack's line, and
   * a second copy nothing drives is a line that stops being true quietly.
   */
  it('is spent by a spell attack as readily as by a club', () => {
    // The casting spent this turn's Action, so the Fire Bolt comes on the
    // caster's next one — which the grant outlives, as the deadline fixture
    // below asserts from the other side.
    let log: readonly GameEvent[] = [...SETUP, ...hitting(SETUP)];
    for (let i = 0; i < 3; i += 1) log = nextTurn(log);
    const state = fold('seed', log);
    expect(whoseTurn(state)).toBe(CASTER);
    expect(modifiersOn(state, TARGET)).toHaveLength(1);

    const bolted = must(
      resolveSpell(state, CASTER, { spellId: 'fire-bolt', targets: [TARGET] }, supply('fire')),
    );
    expect(bolted.outcomes[0]?.attack?.roll.mode).toBe('advantage');

    const spent = applyAll(state, bolted.events);
    expect(modifiersOn(spent, TARGET)).toEqual([]);

    // And the next attack finds nothing left, whoever makes it and however.
    const after = must(swing(spent, OTHER, TARGET));
    expect(after.attack?.roll.mode).toBe('normal');
  });

  it('ends at the caster’s deadline when nobody swings', () => {
    let log: readonly GameEvent[] = [...SETUP, ...hitting(SETUP)];
    // "before the end of your next turn": the caster acts first, so their
    // next turn ends after the whole order has come round again.
    for (let i = 0; i < 3; i += 1) log = nextTurn(log);
    expect(whoseTurn(fold('seed', log))).toBe(CASTER);
    expect(modifiersOn(fold('seed', log), TARGET)).toHaveLength(1);

    for (let i = 0; i < 3; i += 1) log = nextTurn(log);
    expect(modifiersOn(fold('seed', log), TARGET)).toEqual([]);
  });
});

/**
 * Both spells join the turn-anchored population, which is a consequence worth
 * asserting rather than discovering.
 *
 * Each names a moment in the turn order — "before the end of your next turn",
 * "before the end of its next turn" — and SRD gives those no meaning where
 * there are no turns. `turn-context.test.ts` settled what the engine does about
 * that for Ray of Frost: it **asks**, before the slot, the action and the first
 * die, and the request names the command that would answer it. Guiding Bolt and
 * Vicious Mockery are the same sentence and get the same answer.
 */
describe('a one-shot grant outside combat asks for a turn order', () => {
  it('names beginCombat and costs the caster nothing', () => {
    const before = fold('seed', PLACED);
    const dice = supply('mock');
    const snapshot = { rng: dice.rng.snapshot(), rolls: dice.issuer.count };

    const out = resolveSpell(
      before,
      CASTER,
      { spellId: 'vicious-mockery', targets: [TARGET] },
      dice,
    );

    expect(isNeedsContext(out)).toBe(true);
    expect(contextRequestsOf(out).map((r) => r.kind)).toEqual(['turn-order']);

    // And the other end of the relation says the same, so this is the shape
    // asking rather than one spell's transcription.
    const bolt = resolveSpell(
      before,
      CASTER,
      { spellId: 'guiding-bolt', targets: [TARGET], slotLevel: 1 },
      supply('bolt'),
    );
    expect(isNeedsContext(bolt)).toBe(true);
    expect(contextRequestsOf(bolt).map((r) => r.kind)).toEqual(['turn-order']);
    // Nothing moved: not the generator, not the state.
    expect(fold('seed', PLACED)).toEqual(before);
    expect(dice.rng.snapshot()).toEqual(snapshot.rng);
    expect(dice.issuer.count).toBe(snapshot.rolls);
  });
});

/**
 * A deadline anchored on the target asks about **the target**.
 *
 * SRD Vicious Mockery ends at "the end of **its** next turn", and a creature
 * can be in the fight without being in the order: `joinCombat` exists for
 * exactly that. So the pre-flight that asks whether the moment can exist has
 * to ask it of the creature the moment is about, one request per target that
 * cannot be pinned — which is the shape `delayedDuration` already uses two
 * paragraphs further down the same function, and the reason its comment gives
 * is the one that applies here: "It used to resolve in part and forgive the
 * rest: the slot went, the attack rolled, the first hit landed."
 *
 * Asked of the caster instead, this casting passed the pre-flight, rolled the
 * save, and was then refused by `schedule` with a bare `not_in_combat` —
 * after the generator had moved, which is the one thing asking early exists to
 * prevent.
 */
describe('a target outside the initiative order is asked about before the die', () => {
  it('asks for the turn order and spends nothing at all', () => {
    const before = fold('seed', SETUP);
    expect(whoseTurn(before)).toBe(CASTER);
    // In the fight in every sense the world records, and not in the order.
    expect(before.combat?.turnCounts[LATECOMER]).toBeUndefined();

    const dice = supply('mock');
    const snapshot = { rng: dice.rng.snapshot(), rolls: dice.issuer.count };

    const out = resolveSpell(
      before,
      CASTER,
      { spellId: 'vicious-mockery', targets: [LATECOMER] },
      dice,
    );

    expect(isNeedsContext(out)).toBe(true);
    const requests = contextRequestsOf(out);
    expect(requests.map((r) => r.kind)).toEqual(['turn-order']);
    // **About the target, not the caster** — which is the whole defect.
    expect(requests[0]?.subject).toBe(LATECOMER);

    // Nothing was spent: no die, no action, no state.
    expect(fold('seed', SETUP)).toEqual(before);
    expect(dice.rng.snapshot()).toEqual(snapshot.rng);
    expect(dice.issuer.count).toBe(snapshot.rolls);
  });

  /** And the caster-anchored member still asks about the caster. */
  it('leaves Guiding Bolt asking about the caster', () => {
    const out = resolveSpell(
      fold('seed', PLACED),
      CASTER,
      { spellId: 'guiding-bolt', targets: [TARGET], slotLevel: 1 },
      supply('bolt'),
    );
    expect(isNeedsContext(out)).toBe(true);
    expect(contextRequestsOf(out)[0]?.subject).toBe(CASTER);
  });
});

/**
 * The counterpart: the other participant, pinned.
 *
 * Two SRD sentences narrow a modifier to one named creature rather than to
 * anybody — Vex's "Advantage on your next attack roll **against that
 * creature**" and Bestow Curse's "Disadvantage on attack rolls **against
 * you**". A third `RollRelation` could not carry either, because an enum
 * member cannot hold an id; what both need is the participant the relation
 * does not name, written down.
 */
describe('a counterpart pins the other participant', () => {
  const against = (counterpart?: CharacterId): RollSelector => ({
    roll: 'attack',
    relation: 'roller',
    ...(counterpart === undefined ? {} : { counterpart }),
  });

  it('narrows the match to rolls against that creature', () => {
    const selector = against(TARGET);
    expect(
      selectorMatches(selector, CASTER, { family: 'attack', roller: CASTER, against: TARGET }),
    ).toBe(true);
    expect(
      selectorMatches(selector, CASTER, { family: 'attack', roller: CASTER, against: OTHER }),
    ).toBe(false);
  });

  it('leaves an unpinned selector matching anybody', () => {
    expect(
      selectorMatches(against(), CASTER, { family: 'attack', roller: CASTER, against: OTHER }),
    ).toBe(true);
  });

  /**
   * **`rollModifierKey` has to carry it.** A Vex attacker with two goblins in
   * front of them holds two grants from one source, and a key that stopped at
   * the selector's roll would have made the second replace the first — one
   * sentence losing half of itself between the state and the roll, which is
   * the fault `rollModifierKey` was written for in the first place.
   */
  it('is part of what makes two grants the same grant', () => {
    expect(rollModifierKey('Vex', against(TARGET))).not.toBe(
      rollModifierKey('Vex', against(OTHER)),
    );
    expect(rollModifierKey('Vex', against(TARGET))).toBe(rollModifierKey('Vex', against(TARGET)));
  });
});

/**
 * The validator's half, by name.
 *
 * A counterpart is the other participant in the roll, and an attack roll is
 * the one D20 Test the engine records a second participant for — the rule
 * `against-holder` already obeys, arriving on the other axis.
 */
describe('a counterpart off a non-attack roll is refused at authoring', () => {
  const withRider = (roll: string): SpellDefinition =>
    ({
      id: 'homebrew-hex',
      name: 'Homebrew Hex',
      level: 1,
      school: 'necromancy',
      castingTime: 'action',
      concentration: true,
      durationSeconds: 60,
      range: { kind: 'ranged', feet: 30 },
      targets: { count: 1 },
      effects: [
        {
          kind: 'save-damage',
          ability: 'wis',
          damage: { dice: '1d6' },
          damageType: 'psychic',
          onSuccess: 'none',
          modifiers: [
            {
              kind: 'mode',
              counterpart: 'caster',
              modifier: { mode: 'disadvantage', selector: { roll, relation: 'roller' } },
            },
          ],
        },
      ],
    }) as unknown as SpellDefinition;

  it('accepts one on an attack roll', () => {
    expect(checkSpellDefinition(withRider('attack'))).toEqual([]);
  });

  it('refuses one on a saving throw', () => {
    const problems = checkSpellDefinition(withRider('saving-throw'));
    expect(problems.map((p) => p.code)).toContain('counterpart_without_target');
  });
});

/**
 * A one-shot on a roll nothing spends is refused where it is written.
 *
 * Only the two attack rollers emit the consumption, so the flag would compile,
 * land, and then run to its deadline while the definition read as a one-shot
 * — a durable grant wearing the field's name. The restriction is this
 * engine's and not the book's, and the refusal says so.
 */
describe('a one-shot modifier off an attack roll is refused at authoring', () => {
  const onFamily = (roll: string): SpellDefinition =>
    ({
      id: 'homebrew-jinx',
      name: 'Homebrew Jinx',
      level: 1,
      school: 'enchantment',
      castingTime: 'action',
      concentration: true,
      durationSeconds: 60,
      range: { kind: 'ranged', feet: 30 },
      targets: { count: 1 },
      effects: [
        {
          kind: 'save-damage',
          ability: 'wis',
          damage: { dice: '1d6' },
          damageType: 'psychic',
          onSuccess: 'none',
          modifiers: [
            {
              kind: 'mode',
              modifier: {
                mode: 'disadvantage',
                selector: { roll, relation: 'roller' },
                oneShot: true,
              },
            },
          ],
        },
      ],
    }) as unknown as SpellDefinition;

  it('accepts one on an attack roll', () => {
    expect(checkSpellDefinition(onFamily('attack'))).toEqual([]);
  });

  it.each(['saving-throw', 'ability-check', 'initiative', 'death-save'])(
    'refuses one on a %s',
    (roll) => {
      expect(checkSpellDefinition(onFamily(roll)).map((p) => p.code)).toContain(
        'one_shot_off_an_attack',
      );
    },
  );
});

/**
 * The same rule at the other door, which was not keeping it.
 *
 * A `roll-mode` grant is written in two places — a spell definition's rider,
 * checked by `spell-schema.ts`, and a standing grant on an **item**, checked by
 * `content.ts` — and only the first asked about `oneShot`. The second
 * validated the modifier through its selector alone, so a ring could promise
 * "your next saving throw" and quietly hand over a grant that runs to its
 * deadline instead: the durable grant wearing the field's name, at the door
 * the spell side had a refusal for.
 *
 * One rule, two doors, and `oneShotProblem` is the one sentence both say.
 */
describe('an item may not promise a one-shot nothing spends either', () => {
  const ring = (roll: string, oneShot: boolean): CatalogueItem =>
    ({
      id: 'ring-of-the-jinx',
      name: 'Ring of the Jinx',
      kind: 'wondrous',
      weightLb: null,
      costCp: null,
      armor: null,
      weapon: null,
      contents: [],
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [
            {
              kind: 'roll-mode',
              modifier: {
                mode: 'advantage',
                selector: { roll, relation: 'roller' },
                ...(oneShot ? { oneShot: true } : {}),
              },
            },
          ],
          requires: [{ kind: 'while-worn' }],
        },
      ],
    }) as unknown as CatalogueItem;

  it('accepts one on an attack roll, which is the roll that spends it', () => {
    expect(checkContent({ items: [ring('attack', true)] })).toEqual([]);
  });

  it.each(['saving-throw', 'ability-check', 'initiative', 'death-save'])(
    'refuses one on a %s',
    (roll) => {
      expect(checkContent({ items: [ring(roll, true)] }).map((p) => p.code)).toContain(
        'one_shot_off_an_attack',
      );
    },
  );

  /**
   * **And the family is judged before the ending is.**
   *
   * The gate above asks `oneShotProblem` only of a family the rollers know,
   * for the reason the spell side does: a family that is not a family should
   * draw its own problem rather than a second one about how its grant ends.
   * The spell side gets that for free — `checkSpellDefinition` refuses an
   * unknown family a few lines earlier — and this door had no such refusal at
   * all, so `{ roll: 'wibble', oneShot: true }` loaded clean and skipped the
   * guard entirely: the one input a validator exists to catch, waved through
   * by the check that was meant to catch it.
   */
  it.each(['wibble', 'Attack', 'attack-roll', ''])('refuses "%s" as a roll family', (roll) => {
    expect(checkContent({ items: [ring(roll, true)] }).map((p) => p.code)).toContain(
      'bad_roll_family',
    );
  });

  it('says nothing about a one-shot on a family it has already refused', () => {
    const codes = checkContent({ items: [ring('wibble', true)] }).map((p) => p.code);
    expect(codes).not.toContain('one_shot_off_an_attack');
  });

  it('accepts every family the rollers know', () => {
    for (const roll of ['attack', 'ability-check', 'saving-throw', 'initiative', 'death-save']) {
      expect(checkContent({ items: [ring(roll, false)] }), roll).toEqual([]);
    }
  });

  /**
   * And the list this door now asks is the vocabulary the rollers hold.
   *
   * `ROLL_FAMILIES` is `RollFamily` written out as data — the same shape
   * `ITEM_EFFECT_KINDS` takes over `standing.ts`'s union — and exporting it for
   * this door made a hand-maintained copy load-bearing in a second place. So
   * the two are held equal in both directions rather than trusted: a member
   * added to the union without this line changing would be a family the spell
   * validator refused and the item validator had never heard of.
   */
  it('holds the set equal to the union it is a copy of', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./roll-modifiers.ts', import.meta.url)),
      'utf8',
    );
    const declared = /export type RollFamily =([\s\S]*?);\n/.exec(source);
    expect(declared).not.toBeNull();
    const members = [...declared![1]!.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]!);
    expect(members.length).toBeGreaterThan(1);
    expect([...members].sort()).toEqual([...ROLL_FAMILIES].sort());
  });

  /** And the refusal is the flag's, not the family's: without it, the same item loads. */
  it.each(['saving-throw', 'ability-check', 'initiative', 'death-save'])(
    'leaves a durable mode on a %s alone',
    (roll) => {
      expect(checkContent({ items: [ring(roll, false)] })).toEqual([]);
    },
  );

  /** The two doors say the same sentence, because they ask the same function. */
  it('refuses it in the same words the spell side does', () => {
    const fromAnItem = checkContent({ items: [ring('saving-throw', true)] }).find(
      (problem) => problem.code === 'one_shot_off_an_attack',
    );
    const fromASpell = checkSpellDefinition(
      {
        id: 'homebrew-jinx',
        name: 'Homebrew Jinx',
        level: 1,
        school: 'enchantment',
        castingTime: 'action',
        concentration: true,
        durationSeconds: 60,
        range: { kind: 'ranged', feet: 30 },
        targets: { count: 1 },
        effects: [
          {
            kind: 'save-damage',
            ability: 'wis',
            damage: { dice: '1d6' },
            damageType: 'psychic',
            onSuccess: 'none',
            modifiers: [
              {
                kind: 'mode',
                modifier: {
                  mode: 'disadvantage',
                  selector: { roll: 'saving-throw', relation: 'roller' },
                  oneShot: true,
                },
              },
            ],
          },
        ],
      } as unknown as SpellDefinition,
    ).find((problem) => problem.code === 'one_shot_off_an_attack');

    expect(fromAnItem?.reason).toBe(fromASpell?.reason);
    // And it says which field, in the shape an author can act on.
    expect(fromAnItem?.field).toContain('oneShot');
  });
});

/**
 * A casting has one duration and may have caught several creatures, so the
 * member that names *its* next turn means nothing in that position.
 *
 * Refused where it is written, which is also what keeps `riderDuration`'s one
 * throw — the target-anchored moment with no target — out of a content
 * author's reach: after the pre-flight split, the only callers that pass no
 * target are the ones that cannot reach the member.
 */
it('refuses a casting whose own deadline is anchored on a target', () => {
  const definition = {
    ...SRD_CONTENT.spell('guiding-bolt')!,
    durationUntil: 'end-of-targets-next-turn',
  } as unknown as SpellDefinition;

  expect(checkSpellDefinition(definition).map((p) => p.code)).toContain(
    'casting_duration_without_a_target',
  );
});

/** Both catalogue entries say what they do, with nothing left over. */
describe('the two SRD spells stop naming the clause as unmodelled', () => {
  it('Guiding Bolt and Vicious Mockery model their one-shot clause', () => {
    for (const spellId of ['guiding-bolt', 'vicious-mockery']) {
      const definition = SRD_CONTENT.spell(spellId);
      expect(definition).toBeDefined();
      expect(definition?.unmodelled ?? []).toEqual([]);
      expect(checkSpellDefinition(definition!)).toEqual([]);
    }
  });

  it('refuses a one-shot grant on an Instantaneous casting with no deadline', () => {
    const naked = {
      ...SRD_CONTENT.spell('vicious-mockery')!,
      effects: [
        {
          ...(SRD_CONTENT.spell('vicious-mockery')!.effects[0] as Record<string, unknown>),
          modifiers: [
            {
              kind: 'mode',
              modifier: {
                mode: 'disadvantage',
                selector: { roll: 'attack', relation: 'roller' },
                oneShot: true,
              },
            },
          ],
        },
      ],
    } as unknown as SpellDefinition;

    expect(checkSpellDefinition(naked).map((p) => p.code)).toContain('grant_without_lifetime');
  });
});

/** A refusal is a value: nothing above turned one into a throw. */
it('leaves the ordinary refusals alone', () => {
  const state = fold('seed', SETUP);
  const nobody = resolveAttack(
    state,
    id('nobody'),
    { target: TARGET, weapon: null, free: true },
    supply('nobody'),
  );
  expect(isErr(nobody)).toBe(true);
});
