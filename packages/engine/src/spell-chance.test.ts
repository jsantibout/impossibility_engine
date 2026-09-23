import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng, type RngState } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey, tallied } from './resources.js';
import { advanceTime, resolveDeclaredCast, resolveSpell } from './commands.js';
import { beginRest, endRest } from './rest.js';
import { declaredCasting } from './spellcasting.js';
import { loadContent } from './content.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { dmDecisionsIn } from './spell-definitions.js';

/**
 * A random outcome that is not a d20: SRD Augury.
 *
 * > "If you cast the spell more than once before finishing a Long Rest, there
 * > is a cumulative 25 percent chance for each casting after the first that
 * > you get no answer."
 *
 * The omen itself is the GM's — "The GM chooses the omen from the Omens table"
 * — and has been handed over since `dmDecides` landed. The only random thing
 * in the spell is the *no answer*, and it is the Wind Fan's sentence pointed
 * at a casting: a count of uses back to a rest, a percentage that grows with
 * it, and a d100 thrown against the percentage. The two rules that machinery
 * already keeps are kept here: **the die is not thrown when the chance is
 * zero**, and the failure suppresses the handover rather than reporting an
 * omen nobody received.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 12, con: 12, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
});

const SETUP: readonly GameEvent[] = [
  {
    type: 'creature-added',
    id: CLERIC,
    name: 'cleric',
    sheet: sheet(),
    maxHp: 40,
    diesAtZero: false,
    creatureType: 'Humanoid',
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CLERIC,
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
    id: CLERIC,
    spellcasting: declaredCasting({
      ability: 'wis',
      cantrips: ['guidance'],
      prepared: ['augury'],
    }),
  },
  // Augury is Range: Self and measures nothing, but a casting that names a
  // creature is held to the spell's range and the range is checked against a
  // scene. So there is one.
  { type: 'scene-set', extent: { width: 100, depth: 100, height: 20 } },
  { type: 'landmark-added', name: 'the shrine', at: { x: 10, y: 10, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the shrine' }, feet: 0 } },
];

const supply = (state: GameState, rng?: Rng) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: rng ?? (state.rng === null ? createRng('omens') : restoreRng(state.rng)),
  content: SRD_CONTENT,
});

/** A generator that shows one face, so which side of a percentage is the test's. */
const always = (face: number): Rng => ({
  int: () => face,
  snapshot: (): RngState => [0, 0, 0, 0],
});

/**
 * One whole Augury: the rite is declared, the minute passes, and it settles.
 *
 * SRD prints "1 minute or Ritual", so the casting is long and goes through the
 * declaration the engine gives every rite. The die is the settlement's.
 */
const augur = (
  log: readonly GameEvent[],
  rng?: Rng,
): { readonly log: readonly GameEvent[]; readonly unverified: readonly string[]; readonly events: readonly GameEvent[] } => {
  const declared = unwrap(
    resolveSpell(
      fold('seed', log),
      CLERIC,
      { spellId: 'augury', targets: [CLERIC], slotLevel: 2 },
      supply(fold('seed', log)),
    ),
    'the rite begins',
  );
  const open = [...log, ...declared.events];
  const tick = unwrap(advanceTime(fold('seed', open), 60, 'the rite'), 'a minute passes');
  const ticked = [...open, ...tick];
  const state = fold('seed', ticked);
  const settled = unwrap(
    resolveDeclaredCast(state, declared.castingId!, supply(state, rng)),
    'the rite ends',
  );
  return {
    log: [...ticked, ...settled.events],
    unverified: settled.unverified,
    events: settled.events,
  };
};

const hundreds = (events: readonly GameEvent[]) =>
  events.filter(
    (e): e is Extract<GameEvent, { type: 'roll-recorded' }> =>
      e.type === 'roll-recorded' && e.label.includes('1d100'),
  );

const OMEN = 'The GM chooses the omen from the Omens table.';

// — the count and the die ————————————————————————————————————————————————————

describe('a cumulative percentage counted back to a Long Rest', () => {
  it('throws no die for the first casting after a rest', () => {
    const first = augur(SETUP);
    expect(hundreds(first.events)).toHaveLength(0);
    // And no generator moved at all, which is the rule the item precedent
    // keeps: a die thrown for a decided outcome moves the generator for
    // nothing, and that is how a replay stops matching.
    expect(first.events.filter((e) => e.type === 'rolls-issued')).toHaveLength(0);
    expect(dmDecisionsIn(first.unverified)).toContain(OMEN);
  });

  it('counts the casting whether or not a die was thrown', () => {
    const first = augur(SETUP);
    expect(tallied(fold('seed', first.log).creatures[CLERIC]!.resources, 'augury')).toBe(1);
  });

  it('throws exactly one d100 against 25 for the second', () => {
    const second = augur(augur(SETUP).log, always(99));
    const thrown = hundreds(second.events);
    expect(thrown).toHaveLength(1);
    expect(thrown[0]!.label).toContain('25%');
    expect(thrown[0]!.who).toBe(CLERIC);
    expect(second.events.filter((e) => e.type === 'rolls-issued')).toHaveLength(1);
  });

  it('gives an answer when the die beats the chance', () => {
    const second = augur(augur(SETUP).log, always(99));
    expect(hundreds(second.events)[0]!.outcome).toBe('an answer');
    expect(dmDecisionsIn(second.unverified)).toContain(OMEN);
  });

  /**
   * "There is a cumulative 25 percent chance … that you get **no answer**."
   * The casting happened, the slot is gone and the minute was spent; what the
   * caster does not get is the omen, so the handover must not go out.
   */
  it('suppresses the omen when the die falls under the chance', () => {
    const second = augur(augur(SETUP).log, always(1));
    expect(hundreds(second.events)[0]!.outcome).toBe('no answer');
    expect(dmDecisionsIn(second.unverified)).not.toContain(OMEN);
    expect(second.unverified.some((line) => line.includes('no answer'))).toBe(true);
  });

  it('raises the chance to 50 for the third', () => {
    const third = augur(augur(augur(SETUP).log, always(99)).log, always(99));
    expect(hundreds(third.events)[0]!.label).toContain('50%');
  });

  /** SRD: "before finishing a Long Rest". Finishing one starts the count again. */
  it('forgets the count over a Long Rest', () => {
    const twice = augur(augur(SETUP).log, always(99)).log;
    const state = fold('seed', twice);
    const begun = unwrap(beginRest(state, CLERIC, 'long'), 'rest begins');
    const resting = [...twice, ...begun];
    const passed = unwrap(
      advanceTime(fold('seed', resting), 8 * 3600, 'the night'),
      'the night passes',
    );
    const slept = [...resting, ...passed];
    const ended = unwrap(endRest(fold('seed', slept), CLERIC), 'rest ends');
    const after = [...slept, ...ended.events];
    expect(tallied(fold('seed', after).creatures[CLERIC]!.resources, 'augury')).toBe(0);

    const next = augur(after);
    expect(hundreds(next.events)).toHaveLength(0);
    expect(dmDecisionsIn(next.unverified)).toContain(OMEN);
  });

  it('folds the same log to the same state, byte for byte', () => {
    const one = augur(augur(SETUP).log);
    const two = augur(augur(SETUP).log);
    expect(JSON.stringify(one.events)).toBe(JSON.stringify(two.events));
    expect(JSON.stringify(fold('seed', one.log))).toBe(JSON.stringify(fold('seed', two.log)));
  });
});

// — the flat form ————————————————————————————————————————————————————————————

const FLAT = {
  id: 'coin-toss',
  name: 'Coin Toss',
  level: 1,
  school: 'divination',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'self' },
  targets: { count: 1, self: true },
  effects: [{ kind: 'chance', percent: 50, onFailure: 'no-answer' }],
  dmDecides: ['The GM says which way it fell.'],
};

const withEffect = (over: Record<string, unknown>): unknown => ({
  ...FLAT,
  effects: [{ ...FLAT.effects[0], ...over }],
});

const problemsIn = (definition: unknown): readonly string[] =>
  checkSpellDefinitionValue(definition).map((problem) => problem.code);

describe('a flat percentage is the general case', () => {
  const homebrew = () =>
    unwrap(loadContent({ spells: [JSON.parse(JSON.stringify(FLAT))] }), 'a homebrew chance');

  const toss = (face: number) => {
    const content = homebrew();
    const log: readonly GameEvent[] = [
      SETUP[0]!,
      {
        type: 'spellcasting-declared',
        id: CLERIC,
        spellcasting: declaredCasting({
          ability: 'wis',
          cantrips: [],
          prepared: ['coin-toss'],
        }),
      },
      ...SETUP.slice(1, 4),
      ...SETUP.slice(5),
    ];
    const state = fold('seed', log);
    return unwrap(
      resolveSpell(
        state,
        CLERIC,
        { spellId: 'coin-toss', targets: [CLERIC], slotLevel: 1 },
        { issuer: createRollIssuer('r'), rng: always(face), content },
      ),
      'the toss',
    );
  };

  it('throws the die on the very first casting', () => {
    const out = toss(99);
    expect(hundreds(out.events)).toHaveLength(1);
    expect(hundreds(out.events)[0]!.label).toContain('50%');
    expect(dmDecisionsIn(out.unverified)).toContain('The GM says which way it fell.');
  });

  it('suppresses the handover on a failure', () => {
    const out = toss(1);
    expect(dmDecisionsIn(out.unverified)).not.toContain('The GM says which way it fell.');
  });
});

describe('the validator', () => {
  it('accepts both forms', () => {
    expect(problemsIn(FLAT)).toEqual([]);
    expect(
      problemsIn(
        withEffect({
          percent: { perPriorCasting: 25, countedBy: { key: 'coin-toss', recovers: 'long-rest' } },
        }),
      ),
    ).toEqual([]);
  });

  it('refuses a percentage outside the range a die can be thrown against', () => {
    expect(problemsIn(withEffect({ percent: 0 })).length).toBeGreaterThan(0);
    expect(problemsIn(withEffect({ percent: 101 })).length).toBeGreaterThan(0);
    expect(problemsIn(withEffect({ percent: 'half' })).length).toBeGreaterThan(0);
  });

  it('refuses a cumulative form with nothing to count against', () => {
    expect(
      problemsIn(withEffect({ percent: { perPriorCasting: 25 } })).length,
    ).toBeGreaterThan(0);
    expect(
      problemsIn(
        withEffect({
          percent: { perPriorCasting: 25, countedBy: { key: '', recovers: 'long-rest' } },
        }),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      problemsIn(
        withEffect({
          percent: { perPriorCasting: 25, countedBy: { key: 'x', recovers: 'whenever' } },
        }),
      ).length,
    ).toBeGreaterThan(0);
  });

  it('refuses a failure it has no rule for', () => {
    expect(problemsIn(withEffect({ onFailure: 'explodes' })).length).toBeGreaterThan(0);
  });
});
