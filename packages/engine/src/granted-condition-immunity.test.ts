import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { applyConditionTo, resolveSpell } from './commands.js';
import { conditionImmunitiesOf } from './standing.js';
import { spellOn } from './fold/release.js';
import { MIND_BLANK, type SpellDefinition } from './spell-definitions.js';
import { checkSpellDefinition, type SpellDefinitionProblem } from './spell-schema.js';

/**
 * A condition Immunity an effect grants — the seventh sourced grant family.
 *
 * SRD Mind Blank, whole: "Until the spell ends, one willing creature you touch
 * has Immunity to Psychic damage and the Charmed condition." IE-017 built the
 * damage half of that sentence and deliberately did not touch the condition
 * half, because a stat block prints damage types and conditions in one run and
 * the engine treats them completely differently. This is the half it left.
 *
 * The grant sits on the creature beside the six sourced grants that were
 * already there — `bonuses`, `armorClasses`, `rollModifiers`,
 * `grantedDefenses`, `speedModifiers` and `attackRiders` — and ends through the
 * one door they all end through. What is asserted here is the three doors, the
 * union with the printed table, and that two castings are two grants.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const ABJURER = id('abjurer');
const ENCHANTER = id('enchanter');
const FIGHTER = id('fighter');
const SQUIRE = id('squire');
const ZOMBIE = id('zombie');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 16,
  abilities: { str: 10, dex: 14, con: 16, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const slots = (who: CharacterId): GameEvent[] =>
  [1, 2, 3, 4, 5, 6, 7, 8].map((level) => ({
    type: 'resource-pool-declared',
    id: who,
    pool: {
      key: spellSlotKey(level),
      label: `level ${level} spell slot`,
      max: 4,
      recovers: 'long-rest',
    },
  }));

const PREPARED = ['mind-blank', 'charm-person'];

const casts = (who: CharacterId): GameEvent => ({
  type: 'spellcasting-declared',
  id: who,
  spellcasting: declaredCasting({
    ability: 'int',
    classId: 'wizard',
    cantrips: [],
    prepared: PREPARED,
  }),
});

const SETUP: readonly GameEvent[] = [
  added(WIZARD),
  added(ABJURER),
  added(ENCHANTER),
  added(FIGHTER),
  added(SQUIRE),
  // SRD Zombie: "Immunities Poison; Exhaustion, Poisoned" — one damage type and
  // two conditions, which is the printed half of the run this grant is the
  // other half of.
  {
    type: 'creature-added',
    id: ZOMBIE,
    name: 'zombie',
    sheet: sheet(),
    maxHp: 22,
    diesAtZero: true,
    creatureType: 'Undead',
    conditionImmunities: ['exhaustion', 'poisoned'],
  },
  ...slots(WIZARD),
  ...slots(ABJURER),
  ...slots(ENCHANTER),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the ford', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the ford' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: FIGHTER,
    placement: { from: { creature: WIZARD }, feet: 5, bearing: 0 },
  },
  {
    type: 'creature-placed',
    id: ABJURER,
    placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 },
  },
  {
    type: 'creature-placed',
    id: ENCHANTER,
    placement: { from: { creature: WIZARD }, feet: 5, bearing: 180 },
  },
  {
    type: 'creature-placed',
    id: SQUIRE,
    placement: { from: { creature: WIZARD }, feet: 10, bearing: 270 },
  },
  {
    type: 'creature-placed',
    id: ZOMBIE,
    placement: { from: { creature: WIZARD }, feet: 5, bearing: 45 },
  },
  { type: 'sight-declared', from: WIZARD, to: FIGHTER, seen: true },
  { type: 'sight-declared', from: WIZARD, to: ZOMBIE, seen: true },
  { type: 'sight-declared', from: ABJURER, to: FIGHTER, seen: true },
  { type: 'sight-declared', from: ENCHANTER, to: FIGHTER, seen: true },
  { type: 'sight-declared', from: ENCHANTER, to: SQUIRE, seen: true },
  casts(WIZARD),
  casts(ABJURER),
  casts(ENCHANTER),
];

const base = (): GameState => fold('seed', SETUP);

const supply = (seed = 'cast') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
});

const must = <T,>(result: Result<T>): T => unwrap(result, 'granted condition immunity');

const applyAll = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce(applyEvent, state);

/** Mind Blank, cast by one of the three wizards on the fighter. */
const mindBlank = (state: GameState, caster: CharacterId, target: CharacterId = FIGHTER) =>
  must(
    resolveSpell(state, caster, { spellId: 'mind-blank', targets: [target], slotLevel: 8 }, supply()),
  );

/** Whether the Charmed condition may be applied to this creature at all. */
const charmable = (state: GameState, who: CharacterId): boolean =>
  !isErr(applyConditionTo(state, who, 'charmed', 'a test'));

describe('Mind Blank grants an Immunity to the Charmed condition', () => {
  /**
   * SRD Mind Blank: "Until the spell ends, one willing creature you touch has
   * Immunity to Psychic damage **and the Charmed condition**."
   *
   * Cast through the public path, read through the public gatherer, and ended
   * by its printed deadline — "Duration: 24 hours", which is 86,400 seconds.
   */
  it('refuses the condition while it runs and allows it again afterwards', () => {
    const before = base();
    expect(charmable(before, FIGHTER)).toBe(true);

    const cast = mindBlank(before, WIZARD);
    const during = applyAll(before, cast.events);
    expect(conditionImmunitiesOf(during, FIGHTER)).toEqual(['charmed']);
    expect(charmable(during, FIGHTER)).toBe(false);
    expect(must(applyConditionTo(during, FIGHTER, 'frightened', 'a test')).length).toBeGreaterThan(
      0,
    );

    // "Duration: 24 hours" — the casting's own deadline, and the first door.
    const after = applyEvent(during, {
      type: 'time-advanced',
      seconds: 86_400,
      reason: 'the day',
    });
    expect(after.creatures[FIGHTER]?.grantedConditionImmunities).toEqual([]);
    expect(conditionImmunitiesOf(after, FIGHTER)).toEqual([]);
    expect(charmable(after, FIGHTER)).toBe(true);
  });

  /**
   * And the immunity reaches a spell that tries to impose the condition, not
   * only the bare command.
   *
   * The seed is chosen so the **control** fails its save and is Charmed by the
   * very same casting: a target nobody had protected has to land, or the
   * refusal below would be indistinguishable from a successful save.
   */
  it('leaves a Charm Person unaffected while charming the creature beside it', () => {
    const during = applyAll(base(), mindBlank(base(), WIZARD).events);
    const charm = must(
      resolveSpell(
        during,
        ENCHANTER,
        { spellId: 'charm-person', targets: [FIGHTER, SQUIRE], slotLevel: 2, fought: [] },
        supply('charm-seed'),
      ),
    );
    const after = applyAll(during, charm.events);

    // **Both saves fail on this seed**, which is what makes the two answers
    // discriminating: the fighter is not spared by the die.
    const outcomeFor = (who: CharacterId) => charm.outcomes.find((o) => o.target === who);
    expect(outcomeFor(FIGHTER)?.save?.success).toBe(false);
    expect(outcomeFor(SQUIRE)?.save?.success).toBe(false);

    expect(after.creatures[FIGHTER]?.conditions.conditions).toEqual([]);
    expect(after.creatures[SQUIRE]?.conditions.conditions).toEqual(['charmed']);
    expect(outcomeFor(FIGHTER)?.conditions ?? []).toEqual([]);
    expect(outcomeFor(SQUIRE)?.conditions).toEqual(['charmed']);
  });

  /** A casting that grants something to a creature is *on* that creature. */
  it('puts the casting on the creature it is protecting', () => {
    const after = applyAll(base(), mindBlank(base(), WIZARD).events);
    const record = Object.values(after.ongoing)[0]!;
    expect(spellOn(after, record)).toEqual([FIGHTER]);
  });
});

/**
 * The three doors, which is the whole of the plumbing a seventh family needs.
 *
 * Nothing here is new machinery: `releaseCasting`, `releaseOnTarget` and the
 * `grants` deadline all walk `grantsOf`, and the enumerator line is what puts
 * this family in front of all three at once.
 */
describe('a granted condition immunity ends through the doors the other six use', () => {
  it('ends when the casting ends', () => {
    const during = applyAll(base(), mindBlank(base(), WIZARD).events);
    const castingId = Object.keys(during.ongoing)[0]!;
    const ended = applyEvent(during, {
      type: 'spell-ended',
      castingId,
      on: null,
      reason: 'dispelled',
    });
    expect(ended.creatures[FIGHTER]?.grantedConditionImmunities).toEqual([]);
    expect(charmable(ended, FIGHTER)).toBe(true);
  });

  it('ends when the casting is released on one creature', () => {
    const during = applyAll(base(), mindBlank(base(), WIZARD).events);
    const castingId = Object.keys(during.ongoing)[0]!;
    const released = applyEvent(during, {
      type: 'spell-ended',
      castingId,
      on: FIGHTER,
      reason: 'dispelled',
    });
    expect(released.creatures[FIGHTER]?.grantedConditionImmunities).toEqual([]);
    expect(charmable(released, FIGHTER)).toBe(true);
  });

  it('ends on a grants deadline of its own, leaving the casting running', () => {
    const during = applyAll(base(), mindBlank(base(), WIZARD).events);
    const source = during.creatures[FIGHTER]?.grantedConditionImmunities[0]?.source;
    expect(source).toBeDefined();

    const scheduled = applyEvent(during, {
      type: 'effect-scheduled',
      target: { kind: 'grants', on: FIGHTER, source: source! },
      deadline: { kind: 'elapsed', at: 6 },
    });
    const later = applyEvent(scheduled, {
      type: 'time-advanced',
      seconds: 6,
      reason: 'the round',
    });

    expect(later.creatures[FIGHTER]?.grantedConditionImmunities).toEqual([]);
    expect(charmable(later, FIGHTER)).toBe(true);
    // The casting itself is untouched: 24 hours have not passed.
    expect(Object.keys(later.ongoing)).toHaveLength(1);
  });
});

/**
 * Two castings of one spell are two grants, and the printed table is a third
 * input that no grant may weaken.
 *
 * SRD says the answers union rather than override — "multiple instances of
 * Resistance to the same damage type count as only one" is the damage half of
 * the same sentence shape, and an Immunity is a boolean with nothing a second
 * copy could add.
 */
describe('the answers union, and the printed table survives', () => {
  it('keeps the immunity while a second casting still holds it', () => {
    const first = applyAll(base(), mindBlank(base(), WIZARD).events);
    const both = applyAll(first, mindBlank(first, ABJURER).events);
    expect(both.creatures[FIGHTER]?.grantedConditionImmunities).toHaveLength(2);
    // Two instances of one Immunity are one Immunity.
    expect(conditionImmunitiesOf(both, FIGHTER)).toEqual(['charmed']);

    const castingId = Object.keys(both.ongoing).sort()[0]!;
    const one = applyEvent(both, {
      type: 'spell-ended',
      castingId,
      on: null,
      reason: 'dispelled',
    });
    expect(one.creatures[FIGHTER]?.grantedConditionImmunities).toHaveLength(1);
    expect(charmable(one, FIGHTER)).toBe(false);
  });

  it('re-grants from one source rather than stacking', () => {
    const once = applyEvent(base(), {
      type: 'condition-immunity-granted',
      id: FIGHTER,
      immunity: { source: 'Mind Blank#cast:1', conditions: ['charmed'] },
    });
    const twice = applyEvent(once, {
      type: 'condition-immunity-granted',
      id: FIGHTER,
      immunity: { source: 'Mind Blank#cast:1', conditions: ['charmed'] },
    });
    expect(twice.creatures[FIGHTER]?.grantedConditionImmunities).toHaveLength(1);
  });

  it('leaves a printed immunity standing when the casting ends', () => {
    // SRD Zombie prints "Immunities Poison; Exhaustion, Poisoned" — one damage
    // type and two conditions — and the condition half is the creature's own,
    // with no source to end it by. A grant landing on top of it must not be
    // able to take it away.
    const printed = base();
    expect(conditionImmunitiesOf(printed, ZOMBIE)).toEqual(['exhaustion', 'poisoned']);

    const during = applyAll(printed, mindBlank(printed, WIZARD, ZOMBIE).events);
    // One answer, sorted, and the granted Charmed joins rather than replaces.
    expect(conditionImmunitiesOf(during, ZOMBIE)).toEqual(['charmed', 'exhaustion', 'poisoned']);

    const after = applyEvent(during, {
      type: 'time-advanced',
      seconds: 86_400,
      reason: 'the day',
    });
    expect(after.creatures[ZOMBIE]?.grantedConditionImmunities).toEqual([]);
    expect(conditionImmunitiesOf(after, ZOMBIE)).toEqual(['exhaustion', 'poisoned']);
    // The printed half survives the casting; the granted half does not.
    expect(charmable(after, ZOMBIE)).toBe(true);
    expect(isErr(applyConditionTo(after, ZOMBIE, 'poisoned', 'a test'))).toBe(true);
  });

  /**
   * And a grant may not *weaken* a printed entry either, which is the other
   * direction of the union.
   */
  it('cannot take a printed immunity away by granting a different one', () => {
    const during = applyAll(base(), mindBlank(base(), WIZARD, ZOMBIE).events);
    expect(isErr(applyConditionTo(during, ZOMBIE, 'poisoned', 'a test'))).toBe(true);
    expect(isErr(applyConditionTo(during, ZOMBIE, 'exhaustion', 'a test'))).toBe(true);
  });
});

/**
 * The format rules, which are the two a grant of this kind can break.
 *
 * An unknown condition name is refused by the vocabulary every other reader of
 * a condition name already uses, and a grant on a casting that never becomes
 * ongoing is `grant_without_lifetime` — the one code four other things a
 * casting can leave standing already report.
 */
describe('the validator holds a granted immunity to the format rules', () => {
  const withEffects = (over: Partial<SpellDefinition>): SpellDefinition => ({
    ...MIND_BLANK,
    ...over,
  });

  it('refuses a condition name the SRD does not print', () => {
    const problems = checkSpellDefinition(
      withEffects({
        effects: [{ kind: 'condition-immunity', conditions: ['bewildered'] } as never],
      }),
    );
    expect(problems.map((p: SpellDefinitionProblem) => p.code)).toContain('unknown_condition');
  });

  it('refuses an empty list, which is a sentence no spell prints', () => {
    const problems = checkSpellDefinition(
      withEffects({ effects: [{ kind: 'condition-immunity', conditions: [] }] }),
    );
    expect(problems.map((p: SpellDefinitionProblem) => p.code)).toContain('immune_to_nothing');
  });

  /** An Immunity is a boolean, so a second copy of a name adds nothing. */
  it('refuses the same condition twice', () => {
    const problems = checkSpellDefinition(
      withEffects({ effects: [{ kind: 'condition-immunity', conditions: ['charmed', 'charmed'] }] }),
    );
    expect(problems.map((p: SpellDefinitionProblem) => p.code)).toEqual(['duplicate_condition']);
    expect(problems.map((p: SpellDefinitionProblem) => p.field)).toEqual([
      'effects[0].conditions[1]',
    ]);
  });

  it('refuses a grant on a casting that is over the moment it resolves', () => {
    // Mind Blank without its "Duration: 24 hours" is over the moment it
    // resolves, so the Immunity is a grant nothing could ever lift.
    const instantaneous: SpellDefinition = { ...MIND_BLANK };
    delete (instantaneous as { durationSeconds?: number }).durationSeconds;
    const problems = checkSpellDefinition({
      ...instantaneous,
      effects: [{ kind: 'condition-immunity', conditions: ['charmed'] }],
    });
    expect(problems.map((p: SpellDefinitionProblem) => p.code)).toContain('grant_without_lifetime');
  });

  it('accepts Mind Blank as it is written', () => {
    expect(checkSpellDefinition(MIND_BLANK)).toEqual([]);
  });
});
