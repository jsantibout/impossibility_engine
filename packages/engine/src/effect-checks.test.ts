import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, isNeedsContext, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import {
  availableChecks,
  resolveEffectCheck,
  resolveSpell,
  type EffectCheckCommand,
} from './commands.js';
import { conditionRiderOf } from './spell-definitions.js';

/**
 * An ability check a spell offers against something it is still doing.
 *
 * The SRD writes this twenty times — see through the illusion, tear free of
 * the tentacles, disbelieve the terrain — and until now every one of them sat
 * in an `unmodelled` note. That was the wrong answer twice over: the check is
 * pure arithmetic the engine owns, and `checks.ts` had been complete, correct
 * and reachable from **no command at all** since the day it was written. The
 * fourth instance in this codebase of *a pure function nothing calls is a rule
 * nothing enforces*.
 *
 * The boundary this file exists to pin:
 *
 * | | |
 * |---|---|
 * | Maestro | *that* a creature peers at the illusion, or heaves against the vines |
 * | Engine | which ability, which skill, proficiency, Expertise, conditions, the die, the DC, and what a success does |
 *
 * A caller may say who tries. It may not say how it came out, what the DC was,
 * or what modifier applied — and the type system is part of how that is
 * enforced, not a comment about it.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const SCHOLAR = id('scholar');
const OAF = id('oaf');
const BRUTE = id('brute');

/**
 * Int 20 (+5), level 9 (Proficiency +4). Spell save DC 8 + 4 + 5 = **17**.
 *
 * Written out because every expectation below is arithmetic off this sheet: if
 * the engine ever stopped deriving the DC and started taking it from a caller,
 * these numbers are what would stop agreeing.
 */
const SAVE_DC = 17;

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

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 80,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const SETUP: readonly GameEvent[] = [
  added(CASTER),
  // Int 20 and Expertise in Investigation: +5 ability, +8 doubled proficiency.
  added(SCHOLAR, { abilities: { str: 10, dex: 10, con: 10, int: 20, wis: 10, cha: 10 }, skills: { investigation: 'expertise' } }),
  // Int 10 and no proficiency at all: +0, flat.
  added(OAF, { abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } }),
  // Str 20 and proficient in Athletics: +5 ability, +4 proficiency.
  added(BRUTE, { abilities: { str: 20, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, skills: { athletics: 'proficient' } }),
  ...[1, 2, 3, 4, 5].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CASTER,
      pool: { key: spellSlotKey(level), label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the arch', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'the arch' }, feet: 0 } },
  { type: 'creature-placed', id: SCHOLAR, placement: { from: { creature: CASTER }, feet: 10, bearing: 0 } },
  { type: 'creature-placed', id: OAF, placement: { from: { creature: CASTER }, feet: 10, bearing: 90 } },
  // Off on his own, so the tentacles below catch him and nobody else.
  { type: 'landmark-added', name: 'the pit', at: { x: 160, y: 160, z: 0 } },
  { type: 'creature-placed', id: BRUTE, placement: { from: { landmark: 'the pit' }, feet: 0 } },
  { type: 'sight-declared', from: CASTER, to: SCHOLAR, seen: true },
  { type: 'sight-declared', from: CASTER, to: OAF, seen: true },
  { type: 'sight-declared', from: CASTER, to: BRUTE, seen: true },
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      cantrips: SPELL_DEFINITIONS.filter((d) => d.level === 0).map((d) => d.id),
      prepared: SPELL_DEFINITIONS.filter((d) => d.level > 0).map((d) => d.id),
    }),
  },
];

const supply = (seed = 'check') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** Cast a spell and hand back the log it produced. */
const after = (
  spellId: string,
  request: Partial<Parameters<typeof resolveSpell>[2]> = {},
  log: readonly GameEvent[] = SETUP,
): readonly GameEvent[] => {
  const definition = SRD_CONTENT.spell(spellId);
  if (definition === null) throw new Error(`${spellId} has no definition`);
  const out = unwrap(
    resolveSpell(
      fold('seed', log),
      CASTER,
      {
        spellId,
        targets: [],
        ...(definition.level === 0 ? {} : { slotLevel: definition.level }),
        ...request,
      },
      supply('cast'),
    ),
    spellId,
  );
  return [...log, ...out.events];
};

const disguised = () => after('disguise-self');

/** Black Tentacles with the save forced to fail, so somebody is Restrained. */
const tangled = (): readonly GameEvent[] => {
  const out = unwrap(
    resolveSpell(
      fold('seed', SETUP),
      CASTER,
      {
        spellId: 'black-tentacles',
        targets: [],
        // Beside the brute rather than on him: SRD excludes a Cube's point of
        // origin, so an area placed on the target would leave him out of it.
        at: { x: 155, y: 155, z: 0 },
        towards: { x: 160, y: 300, z: 0 },
        slotLevel: 4,
      },
      { ...supply('tangle'), bonuses: [{ source: 'forced', flat: -40 }] },
    ),
    'black-tentacles',
  );
  return [...SETUP, ...out.events];
};

const only = (state: GameState, who: CharacterId) => {
  const checks = availableChecks(state, who);
  expect(checks).toHaveLength(1);
  return checks[0]!;
};

describe('a spell offers the check the SRD says it offers', () => {
  /**
   * SRD Disguise Self: "a creature must take the Study action to inspect your
   * appearance and succeed on an Intelligence (Investigation) check against
   * your spell save DC." Every field of that sentence is here, and the DC is
   * the caster's own rather than a number anybody passed in.
   */
  it('derives the DC from the caster’s sheet, not from the caller', () => {
    const check = only(fold('seed', disguised()), SCHOLAR);
    expect(check.ability).toBe('int');
    expect(check.skill).toBe('investigation');
    expect(check.dc).toBe(SAVE_DC);
    expect(check.onSuccess).toBe('none');
  });

  /** A cantrip has no slot to take a DC from, which is the point of trying one. */
  it('derives a cantrip’s DC from the sheet too', () => {
    const check = only(fold('seed', after('minor-illusion')), SCHOLAR);
    expect(check.dc).toBe(SAVE_DC);
  });

  /** SRD Black Tentacles: "Strength (Athletics) check against your spell save DC". */
  it('offers the escape the tentacles print, to the creature they hold', () => {
    const state = fold('seed', tangled());
    expect(state.creatures.brute?.conditions.conditions).toContain('restrained');

    const check = only(state, BRUTE);
    expect(check.ability).toBe('str');
    expect(check.skill).toBe('athletics');
    expect(check.dc).toBe(SAVE_DC);
    expect(check.onSuccess).toBe('end-on-target');
  });

  /**
   * An effect on a creature is that creature's to shake off. Derived from what
   * the timer sits on rather than declared, and the refusal is what makes that
   * derivation a rule rather than a convention.
   */
  it('refuses a creature attempting somebody else’s escape', () => {
    const state = fold('seed', tangled());
    const key = only(state, BRUTE).effectKey;

    expect(availableChecks(state, SCHOLAR).map((c) => c.effectKey)).not.toContain(key);
    const out = resolveEffectCheck(state, SCHOLAR, { effectKey: key }, supply());
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('not_yours_to_attempt');
  });

  /** An illusion has no victim, so anybody who looks may look. */
  it('offers an illusion’s check to anybody', () => {
    const state = fold('seed', disguised());
    expect(availableChecks(state, SCHOLAR)).toHaveLength(1);
    expect(availableChecks(state, OAF)).toHaveLength(1);
    expect(availableChecks(state, BRUTE)).toHaveLength(1);
  });

  /** A spell that offers nothing offers nothing, rather than a check of zero. */
  it('offers nothing for a spell with no check', () => {
    expect(availableChecks(fold('seed', after('tongues', { targets: [CASTER] })), SCHOLAR)).toEqual([]);
  });
});

describe('the roller’s own numbers are the engine’s to read', () => {
  const roll = (log: readonly GameEvent[], who: CharacterId, seed = 'check') =>
    unwrap(
      resolveEffectCheck(
        fold('seed', log),
        who,
        { effectKey: only(fold('seed', log), who).effectKey },
        supply(seed),
      ),
      'check',
    );

  /**
   * Expertise doubles the Proficiency Bonus, and the difference between the
   * scholar and the oaf is *exactly* that plus their ability modifiers — +13
   * against +0. A test that only asserted "the scholar rolled higher" would
   * pass against an implementation that ignored Expertise entirely.
   */
  it('applies the ability modifier, proficiency and Expertise', () => {
    const log = disguised();
    expect(roll(log, SCHOLAR).check?.modifier).toBe(5 + 2 * 4);
    expect(roll(log, OAF).check?.modifier).toBe(0);
  });

  /** Proficiency once, not twice, for a creature that merely has the skill. */
  it('applies proficiency singly where there is no Expertise', () => {
    expect(roll(tangled(), BRUTE).check?.modifier).toBe(5 + 4);
  });

  /** And the skill's own ability, not the effect's, when the two could differ. */
  it('reads the skill the SRD names', () => {
    const out = roll(tangled(), BRUTE);
    expect(out.check?.skill).toBe('athletics');
    expect(out.check?.ability).toBe('str');
  });

  /**
   * Advantage comes from the one place it has ever come from. The caller may
   * supply a *mode* — the table knows things the engine does not — and the
   * engine combines it with everything it can see, by the same
   * presence-not-arithmetic rule every other D20 Test uses.
   */
  it('takes Advantage through the existing check machinery', () => {
    const log = disguised();
    const key = only(fold('seed', log), SCHOLAR).effectKey;
    const withAdvantage = unwrap(
      resolveEffectCheck(
        fold('seed', log),
        SCHOLAR,
        { effectKey: key, modes: [{ source: 'a good long look', mode: 'advantage' }] },
        supply(),
      ),
      'advantage',
    );
    expect(withAdvantage.check?.mode).toBe('advantage');
    expect(withAdvantage.check?.rolls).toHaveLength(2);
    expect(withAdvantage.check?.modeSources.map((m) => m.source)).toContain('a good long look');
  });

  /** And cancels rather than stacks, exactly as `combineRollModes` says. */
  it('cancels Advantage against Disadvantage', () => {
    const log = disguised();
    const key = only(fold('seed', log), SCHOLAR).effectKey;
    const out = unwrap(
      resolveEffectCheck(
        fold('seed', log),
        SCHOLAR,
        {
          effectKey: key,
          modes: [
            { source: 'a good long look', mode: 'advantage' },
            { source: 'poor light', mode: 'disadvantage' },
          ],
        },
        supply(),
      ),
      'cancel',
    );
    expect(out.check?.mode).toBe('normal');
    expect(out.check?.rolls).toHaveLength(1);
  });

  /** A Blinded creature cannot see through anything, whatever the die says. */
  it('lets a condition fail a sight-dependent check outright', () => {
    const log = [
      ...disguised(),
      { type: 'condition-applied', id: SCHOLAR, condition: 'blinded', source: 'a flash' } as GameEvent,
    ];
    const state = fold('seed', log);
    const out = unwrap(
      resolveEffectCheck(
        state,
        SCHOLAR,
        { effectKey: only(state, SCHOLAR).effectKey, senses: { requiresSight: true } },
        supply(),
      ),
      'blinded',
    );
    expect(out.check?.autoFailed).not.toBeNull();
    expect(out.success).toBe(false);
  });
});

describe('success and failure both bite', () => {
  const attempt = (log: readonly GameEvent[], who: CharacterId, bonus: number) => {
    const state = fold('seed', log);
    return unwrap(
      resolveEffectCheck(
        state,
        who,
        { effectKey: only(state, who).effectKey, bonuses: [{ source: 'forced', flat: bonus }] },
        supply(),
      ),
      'attempt',
    );
  };

  /** SRD: the tentacles let go of that creature, and of nobody else. */
  it('frees the creature that made its escape, and only that creature', () => {
    const log = tangled();
    const before = fold('seed', log);
    expect(before.creatures.brute?.conditions.conditions).toContain('restrained');

    const out = attempt(log, BRUTE, 40);
    expect(out.success).toBe(true);

    const freed = fold('seed', [...log, ...out.events]);
    expect(freed.creatures.brute?.conditions.conditions).not.toContain('restrained');
    // The casting is still running: Concentration held, and its own timer with it.
    expect(freed.creatures.caster?.concentration?.spell).toBe('Black Tentacles');
  });

  it('leaves a creature that failed exactly where it was', () => {
    const log = tangled();
    const out = attempt(log, BRUTE, -40);
    expect(out.success).toBe(false);

    const stuck = fold('seed', [...log, ...out.events]);
    expect(stuck.creatures.brute?.conditions.conditions).toContain('restrained');
  });

  /**
   * An illusion seen through changes nothing the engine holds, and that is the
   * answer rather than a stub: the knowledge is the table's, and the roll that
   * produced it is in the log for anybody who asks why.
   */
  it('changes no state for a check whose success is knowledge', () => {
    const log = disguised();
    const out = attempt(log, SCHOLAR, 40);
    expect(out.success).toBe(true);
    expect(out.onSuccess).toBe('none');
    expect(out.events.some((e) => e.type === 'effect-check-resolved')).toBe(false);

    const seen = fold('seed', [...log, ...out.events]);
    const untouched = fold('seed', log);
    expect({ ...seen, appliedCommands: {}, rng: null, rollsIssued: 0, eventCount: 0 }).toEqual({
      ...untouched,
      appliedCommands: {},
      rng: null,
      rollsIssued: 0,
      eventCount: 0,
    });
  });

  /** The roll is recorded either way, so a log can say why the guard was fooled. */
  it('records the roll whether it lands or not', () => {
    for (const bonus of [40, -40]) {
      const out = attempt(disguised(), SCHOLAR, bonus);
      const recorded = out.events.filter((e) => e.type === 'roll-recorded');
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({ who: SCHOLAR, label: expect.stringContaining('Disguise Self') });
    }
  });
});

describe('the caller says who tries, and nothing else', () => {
  it('has no field for a result, a DC or a modifier', () => {
    const legal: EffectCheckCommand = { effectKey: 'casting|cast:1' };
    expect(legal.effectKey).toBe('casting|cast:1');

    // @ts-expect-error a caller may not say how the check came out.
    const forged: EffectCheckCommand = { effectKey: 'casting|cast:1', success: true };
    // @ts-expect-error nor what it was rolled against.
    const rigged: EffectCheckCommand = { effectKey: 'casting|cast:1', dc: 1 };
    // @ts-expect-error nor what the roller's modifier is.
    const padded: EffectCheckCommand = { effectKey: 'casting|cast:1', modifier: 99 };
    expect([forged, rigged, padded]).toHaveLength(3);
  });

  /**
   * A bonus the caller supplies is honoured — Guidance is real — but it moves
   * the *total*, which the engine then compares to its own DC. There is no
   * route by which a caller reaches `success` directly.
   */
  it('lets a caller add a bonus, and still decides the outcome itself', () => {
    const log = disguised();
    const state = fold('seed', log);
    const key = only(state, SCHOLAR).effectKey;

    const bare = unwrap(resolveEffectCheck(state, SCHOLAR, { effectKey: key }, supply()), 'bare');
    const helped = unwrap(
      resolveEffectCheck(
        state,
        SCHOLAR,
        { effectKey: key, bonuses: [{ source: 'Guidance', dice: '1d4' }] },
        supply(),
      ),
      'helped',
    );
    expect(helped.check!.total).toBeGreaterThan(bare.check!.total);
    expect(helped.check!.success).toBe(helped.check!.total >= SAVE_DC);
  });
});

describe('a check is deterministic, replayable and safe to retry', () => {
  it('produces the same batch from the same state and seed', () => {
    const log = disguised();
    const state = fold('seed', log);
    const key = only(state, SCHOLAR).effectKey;
    const a = unwrap(resolveEffectCheck(state, SCHOLAR, { effectKey: key }, supply('x')), 'a');
    const b = unwrap(resolveEffectCheck(state, SCHOLAR, { effectKey: key }, supply('x')), 'b');
    expect(a).toEqual(b);
  });

  it('replays prefix by prefix', () => {
    const log = tangled();
    const state = fold('seed', log);
    const out = unwrap(
      resolveEffectCheck(
        state,
        BRUTE,
        { effectKey: only(state, BRUTE).effectKey, bonuses: [{ source: 'forced', flat: 40 }] },
        supply(),
      ),
      'escape',
    );
    const whole = [...log, ...out.events];
    for (let n = 0; n <= whole.length; n += 1) {
      expect(fold('seed', whole.slice(0, n))).toEqual(fold('seed', whole.slice(0, n)));
    }
  });

  /** The generator position is recorded, so a resumed session does not reuse a die. */
  it('records the generator it advanced', () => {
    const log = disguised();
    const state = fold('seed', log);
    const out = unwrap(
      resolveEffectCheck(state, SCHOLAR, { effectKey: only(state, SCHOLAR).effectKey }, supply()),
      'check',
    );
    const issued = out.events.filter((e) => e.type === 'rolls-issued');
    expect(issued).toHaveLength(1);
    expect(fold('seed', [...log, ...out.events]).rollsIssued).toBeGreaterThan(
      fold('seed', log).rollsIssued,
    );
  });

  /**
   * A retry rolls nothing and frees nobody a second time. The consequence half
   * matters as much as the die: a creature that failed its escape and retried
   * the command must not find itself free.
   */
  it('rolls once across a retried command id', () => {
    const log = tangled();
    const state = fold('seed', log);
    const key = only(state, BRUTE).effectKey;
    const first = unwrap(
      resolveEffectCheck(state, BRUTE, { effectKey: key, commandId: 'esc-1', bonuses: [{ source: 'forced', flat: 40 }] }, supply()),
      'first',
    );
    const once = [...log, ...first.events];
    const settled = fold('seed', once);

    const retry = unwrap(
      resolveEffectCheck(settled, BRUTE, { effectKey: key, commandId: 'esc-1', bonuses: [{ source: 'forced', flat: 40 }] }, supply()),
      'retry',
    );
    expect(retry.events).toEqual([]);
    expect(retry.duplicate).toBe(true);
    expect(fold('seed', [...once, ...retry.events])).toEqual(settled);
  });

  /** And a failed check's retry does not get a second chance at the die. */
  it('does not reroll a check that failed', () => {
    const log = disguised();
    const state = fold('seed', log);
    const key = only(state, SCHOLAR).effectKey;
    const failed = unwrap(
      resolveEffectCheck(state, SCHOLAR, { effectKey: key, commandId: 'look', bonuses: [{ source: 'forced', flat: -40 }] }, supply()),
      'failed',
    );
    expect(failed.success).toBe(false);

    const before = fold('seed', [...log, ...failed.events]);
    const retry = unwrap(
      resolveEffectCheck(before, SCHOLAR, { effectKey: key, commandId: 'look', bonuses: [{ source: 'forced', flat: -40 }] }, supply()),
      'retry',
    );
    expect(retry.events).toEqual([]);
    expect(before.rollsIssued).toBe(fold('seed', [...log, ...failed.events, ...retry.events]).rollsIssued);
  });
});

describe('the check costs what the SRD says it costs', () => {
  const fighting = (log: readonly GameEvent[]): readonly GameEvent[] => [
    ...log,
    {
      type: 'combat-started',
      combatants: [
        { id: SCHOLAR, initiative: 20, speed: 30 },
        { id: CASTER, initiative: 10, speed: 30 },
        { id: BRUTE, initiative: 5, speed: 30 },
      ],
    },
  ];

  /**
   * Every SRD instance of this shape spends one: "can take an action to make a
   * Strength (Athletics) check", "must take the Study action to inspect your
   * appearance". Uniform across all of them, so no definition states it.
   */
  it('spends the Action in combat', () => {
    const log = fighting(disguised());
    const state = fold('seed', log);
    const out = unwrap(
      resolveEffectCheck(state, SCHOLAR, { effectKey: only(state, SCHOLAR).effectKey }, supply()),
      'check',
    );
    expect(out.events.some((e) => e.type === 'action-spent')).toBe(true);
    expect(fold('seed', [...log, ...out.events]).combat?.budgets.scholar?.action).toBe(false);
  });

  it('refuses a second one on the same turn, and rolls nothing for it', () => {
    const log = fighting(disguised());
    const state = fold('seed', log);
    const key = only(state, SCHOLAR).effectKey;
    const first = unwrap(resolveEffectCheck(state, SCHOLAR, { effectKey: key }, supply()), 'first');
    const spent = fold('seed', [...log, ...first.events]);

    const generator = supply();
    const second = resolveEffectCheck(spent, SCHOLAR, { effectKey: key }, generator);
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.code).toBe('no_action');
    // Validate before rolling: a refusal costs no die and no roll id.
    expect(generator.issuer.count).toBe(0);
  });

  /** Outside combat there is no economy to spend, exactly as with a casting. */
  it('spends nothing out of combat', () => {
    const log = disguised();
    const state = fold('seed', log);
    const out = unwrap(
      resolveEffectCheck(state, SCHOLAR, { effectKey: only(state, SCHOLAR).effectKey }, supply()),
      'check',
    );
    expect(out.events.some((e) => e.type === 'action-spent')).toBe(false);
  });
});

describe('what the engine does not know, and what it simply refuses', () => {
  /**
   * A creature nobody has told the engine about is a thin *record*, and the
   * answer is a request with a provider attached — not a refusal, and never an
   * invented modifier for a sheet that does not exist.
   */
  it('asks for a creature it has never heard of', () => {
    const state = fold('seed', disguised());
    const out = resolveEffectCheck(
      state,
      id('a-passing-stranger'),
      { effectKey: only(state, SCHOLAR).effectKey },
      supply(),
    );
    expect(isErr(out)).toBe(true);
    if (!isErr(out)) return;
    expect(isNeedsContext(out)).toBe(true);
    expect(out.requests?.map((r) => r.kind)).toContain('creature');
  });

  /**
   * An effect key it has never heard of is the opposite answer, and the
   * asymmetry is the point: the engine wrote every timer it holds, so its own
   * ledger is complete knowledge. There is no fact out in the fiction that
   * would make a missing one exist, so this is a refusal rather than a request.
   */
  it('refuses an effect that does not exist, rather than asking about it', () => {
    const out = resolveEffectCheck(
      fold('seed', disguised()),
      SCHOLAR,
      { effectKey: 'casting|cast:99' },
      supply(),
    );
    expect(isErr(out)).toBe(true);
    if (!isErr(out)) return;
    expect(isNeedsContext(out)).toBe(false);
    expect(out.code).toBe('unknown_effect');
  });

  /** And an ongoing effect that offers no check offers none. */
  it('refuses a check against an effect that has none', () => {
    const log = after('tongues', { targets: [CASTER] });
    const state = fold('seed', log);
    const keys = Object.keys(state.timers);
    expect(keys.length).toBeGreaterThan(0);
    const out = resolveEffectCheck(state, SCHOLAR, { effectKey: keys[0]! }, supply());
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('no_check');
  });

  /** The check dies with the thing it was against. */
  it('offers nothing once the casting has ended', () => {
    const log = disguised();
    const ended = fold('seed', [
      ...log,
      { type: 'time-advanced', seconds: 3600, reason: 'the hour passes' } as GameEvent,
    ]);
    expect(availableChecks(ended, SCHOLAR)).toEqual([]);
  });
});

describe('the shape stops where the SRD stops being expressible', () => {
  /**
   * `end-casting` is written by Maze, Phantasmal Force and Detect Thoughts, and
   * every one of them is blocked on something that is not the check: a
   * condition applied with no saving throw, a save whose failure creates
   * something that is not a condition, an ongoing effect a later turn acts
   * through. A value nothing can be written with would be a value nothing
   * reads, so the union does not carry one — and these spells are absent from
   * the catalogue rather than approximated into it.
   */
  // Web left this list when persistent areas landed: its escape check is
  // "no longer Restrained", which is `end-on-target` and always was — what
  // blocked it was the trigger that hands out the Restrained in the first
  // place, not the check that takes it away.
  it.each([['maze'], ['phantasmal-force'], ['detect-thoughts'], ['entangle']])(
    'has not quietly implemented %s',
    (spellId) => {
      expect(SRD_CONTENT.spell(spellId)).toBeNull();
    },
  );

  /** No definition claims an outcome the engine cannot carry out. */
  it('offers only the two outcomes it can perform', () => {
    const outcomes = new Set<string>();
    for (const definition of SPELL_DEFINITIONS) {
      if (definition.check !== undefined) outcomes.add(definition.check.onSuccess);
      // Through the reader that knows where each host spells its riders: a
      // sweep that switched on the kind would go blind the day a host learned
      // to carry more than one, which is exactly what happened to the three
      // copies IE-001 removed.
      for (const effect of definition.effects) {
        for (const rider of conditionRiderOf(effect)) {
          if (rider.check !== undefined) outcomes.add(rider.check.onSuccess);
        }
      }
    }
    expect([...outcomes].sort()).toEqual(['end-on-target', 'none']);
  });

  /**
   * An immediate check needs no durable debt, and must not invent one: nobody
   * is obliged to look at an illusion, so no turn may block waiting for it.
   * This is the whole difference from the repeat save it resembles.
   */
  it('raises no pending debt and blocks no turn', () => {
    const state = fold('seed', tangled());
    expect(Object.keys(state.pendingSaves)).toHaveLength(0);
    expect(availableChecks(state, BRUTE)).toHaveLength(1);
  });
});
