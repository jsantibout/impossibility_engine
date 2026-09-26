import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { actionRulesOn } from './standing.js';
import { equipItem, resolveSpell, takeReady } from './commands.js';

/**
 * A choice of **which effects run**, which is the second arm of
 * `a-choice-made-at-the-casting` and a different mechanism from the first.
 *
 * > SRD Command: "Choose the command from these options: _Approach. Drop.
 * > Flee. Grovel. Halt._"
 * > SRD Thaumaturgy: "You create one of the effects below within range."
 * > SRD Enlarge/Reduce: "the spell enlarges or reduces a creature … (see the
 * > chosen effect below)".
 *
 * `SpellDefinition.choiceStated` substitutes a **value** into an effect the
 * definition already carries, and its own docstring names these three as the
 * arm it deliberately could not express. `SpellDefinition.options` is that
 * arm: a record of named branches, of which one runs, named on the request as
 * the tenth stated fact, refused off the list, and pinned onto the events and
 * the ongoing record beside `choice`.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const CLERIC = id('cleric');
const THUG = id('thug');

const MACE = 'mace';
const SHIELD = 'shield';

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple'],
  ...over,
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(fold('seed', log)), 'command')];

const BASE: readonly GameEvent[] = [
  added(CLERIC),
  added(THUG),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'cleric',
      prepared: ['command', 'enlarge-reduce', 'fire-bolt'],
      cantrips: ['thaumaturgy'],
    }),
  },
  ...[1, 2].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CLERIC,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 6,
        recovers: 'long-rest',
      },
    }),
  ),
  { type: 'items-gained', id: THUG, items: [{ id: MACE, quantity: 1 }], source: 'the alley' },
  { type: 'items-gained', id: THUG, items: [{ id: SHIELD, quantity: 1 }], source: 'the alley' },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the road' }, feet: 0 } },
  { type: 'creature-placed', id: THUG, placement: { from: { creature: CLERIC }, feet: 15 } },
  { type: 'sight-declared', from: CLERIC, to: THUG, seen: true },
];

/** Both hands full, so a Drop has two things to let go of. */
const ARMED: readonly GameEvent[] = (() => {
  const held = run(BASE, (s) => equipItem(s, SRD_CONTENT, THUG, MACE));
  return run(held, (s) => equipItem(s, SRD_CONTENT, THUG, SHIELD));
})();

const FIGHTING: readonly GameEvent[] = [
  ...ARMED,
  {
    type: 'combat-started',
    combatants: [
      { id: CLERIC, initiative: 20, speed: 30 },
      { id: THUG, initiative: 10, speed: 30 },
    ],
  },
];

/** A bonus large enough to settle the save either way. */
const supply = (bonus: number, seed = 'options') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  bonuses: [{ source: 'forced', flat: bonus }],
});

const FAILS = -40;
const SAVES = 40;

const speak = (
  log: readonly GameEvent[],
  over: Record<string, unknown>,
  bonus = FAILS,
): Result<{ readonly events: readonly GameEvent[] }> =>
  resolveSpell(
    fold('seed', log),
    CLERIC,
    { spellId: 'command', targets: [THUG], slotLevel: 1, ...over } as never,
    supply(bonus),
  ) as Result<{ readonly events: readonly GameEvent[] }>;

const spoken = (
  log: readonly GameEvent[],
  over: Record<string, unknown>,
  bonus = FAILS,
): { readonly events: readonly GameEvent[]; readonly state: GameState } => {
  const out = unwrap(speak(log, over, bonus), 'command');
  return { events: out.events, state: fold('seed', [...log, ...out.events]) };
};

// — the fact the casting states —————————————————————————————————————————————

describe('a spell that prints branches is refused until the casting names one', () => {
  it('asks when no word was spoken', () => {
    const out = speak(ARMED, {});
    expect(isErr(out) && out.code).toBe('option_required');
  });

  it('refuses a sixth word', () => {
    const out = speak(ARMED, { option: 'kneel' });
    expect(isErr(out) && out.code).toBe('unknown_option');
  });

  it('refuses an option on a spell that prints none', () => {
    const out = resolveSpell(
      fold('seed', ARMED),
      CLERIC,
      { spellId: 'fire-bolt', targets: [THUG], option: 'halt' } as never,
      supply(FAILS),
    );
    expect(isErr(out) && out.code).toBe('no_option_clause');
  });
});

// — Command, five words ——————————————————————————————————————————————————————

describe('Command runs the branch its caster spoke and no other', () => {
  it('Halt forbids the move, the action and the Bonus Action on the next turn', () => {
    const { state } = spoken(FIGHTING, { option: 'halt' });
    const rules = actionRulesOn(state, THUG);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.rule).toEqual({
      kind: 'forbids',
      slots: ['action', 'bonus-action', 'movement'],
    });
  });

  /**
   * "**On its turn**, the target doesn't move and takes no action or Bonus
   * Action" — one turn, and the rule is lifted at the end of it. Without the
   * deadline the goblin would be Halted for ever, which is the failure
   * `checkGrantLifetimes` refuses on an Instantaneous casting and which
   * nothing else here would notice.
   */
  it('Halt forbids nothing on the turn after that', () => {
    const { events } = spoken(FIGHTING, { option: 'halt' });
    let log: readonly GameEvent[] = [...FIGHTING, ...events];
    // The cleric's turn ends, the thug takes the turn the word governs, and
    // the order wraps back round to the turn after it.
    log = [...log, ...[0, 1, 2].map((): GameEvent => ({ type: 'turn-advanced' }))];
    expect(actionRulesOn(fold('seed', log), THUG)).toEqual([]);
  });

  /**
   * A Ready states its facts at the Ready, because that is where SRD spends
   * the slot — and `ReadyResponse` carries no branch, so a readied Command is
   * refused with the word the caster never got to speak. The refusal is early
   * and free: nothing is spent. Pinned here so that a `ReadyResponse` that
   * later grows the field does so knowingly.
   */
  it('refuses a Ready of a spell that prints branches, before the slot', () => {
    const out = takeReady(
      fold('seed', FIGHTING),
      CLERIC,
      {
        trigger: 'when the thug moves',
        response: { kind: 'spell', spellId: 'command', slotLevel: 1 },
      },
      SRD_CONTENT,
    );
    expect(isErr(out) && out.code).toBe('option_required');
  });

  /**
   * And the deadline is asked for **before the die**, which is the whole of
   * why the pre-flight reads the branch rather than the definition's own list.
   * SRD Command is Instantaneous and Halt's rule ends at the end of the
   * target's next turn, so a casting outside combat has no turn order to pin
   * it to — and asking after the Wisdom save had been rolled would be a
   * casting that resolved in part and forgave the rest.
   */
  it('asks for the turn order before rolling, where the branch needs one', () => {
    const out = speak(ARMED, { option: 'halt' });
    expect(isErr(out) && out.code).toBe('needs_context');
    expect(isErr(out) && out.reason).toContain('an Initiative order');
  });

  /** And the four words that hang no deadline are not asked the question. */
  it('does not ask it of a word whose branch hangs nothing', () => {
    expect(speak(ARMED, { option: 'grovel' }).ok).toBe(true);
  });

  it('Halt hangs nothing on a creature that made the save', () => {
    const { state } = spoken(FIGHTING, { option: 'halt' }, SAVES);
    expect(actionRulesOn(state, THUG)).toEqual([]);
  });

  it('Drop empties both hands', () => {
    const { state } = spoken(ARMED, { option: 'drop' });
    expect(state.creatures[THUG]?.equipped ?? []).toEqual([]);
  });

  it('Drop leaves a creature that made the save holding both', () => {
    const { state } = spoken(ARMED, { option: 'drop' }, SAVES);
    expect((state.creatures[THUG]?.equipped ?? []).map((worn) => worn.id).sort()).toEqual([
      MACE,
      SHIELD,
    ]);
  });

  it('Grovel knocks the target Prone', () => {
    const { state } = spoken(ARMED, { option: 'grovel' });
    expect((state.creatures[THUG]?.conditions.conditions ?? [])).toContain('prone');
  });

  it('Grovel does nothing to a creature that made the save', () => {
    const { state } = spoken(ARMED, { option: 'grovel' }, SAVES);
    expect((state.creatures[THUG]?.conditions.conditions ?? [])).not.toContain('prone');
  });

  it('Approach hands its sentence over by name and moves nobody', () => {
    const out = unwrap(
      resolveSpell(
        fold('seed', ARMED),
        CLERIC,
        { spellId: 'command', targets: [THUG], slotLevel: 1, option: 'approach' } as never,
        supply(FAILS),
      ),
      'command',
    ) as { readonly unverified: readonly string[]; readonly events: readonly GameEvent[] };
    expect(out.unverified.join('\n')).toContain('shortest and most direct route');
    expect(out.events.some((e) => e.type === 'creature-moved')).toBe(false);
  });

  it('does not run another word’s branch', () => {
    const { state } = spoken(FIGHTING, { option: 'grovel' });
    expect(actionRulesOn(state, THUG)).toEqual([]);
    expect(state.creatures[THUG]?.equipped ?? []).toHaveLength(2);
  });
});

// — Enlarge/Reduce, the shell ————————————————————————————————————————————————

describe('Enlarge/Reduce keeps the half its caster chose', () => {
  const cast = (option: string) =>
    resolveSpell(
      fold('seed', ARMED),
      CLERIC,
      { spellId: 'enlarge-reduce', targets: [THUG], slotLevel: 2, option } as never,
      supply(FAILS),
    );

  it('asks when no half was named', () => {
    const out = resolveSpell(
      fold('seed', ARMED),
      CLERIC,
      { spellId: 'enlarge-reduce', targets: [THUG], slotLevel: 2 } as never,
      supply(FAILS),
    );
    expect(isErr(out) && out.code).toBe('option_required');
  });

  it('pins the branch onto the ongoing record', () => {
    const out = unwrap(cast('enlarge'), 'enlarge') as { readonly events: readonly GameEvent[] };
    const state = fold('seed', [...ARMED, ...out.events]);
    const record = Object.values(state.ongoing).find((one) => one.spellId === 'enlarge-reduce');
    expect(record?.option).toBe('enlarge');
  });

  /**
   * Both halves of Enlarge/Reduce are executed now and file nothing, so the
   * branch whose sentences are reported is Command's: Approach hands its route
   * to the table and Flee's is not spoken.
   */
  it('reports the branch’s own sentences by name', () => {
    const out = unwrap(speak(ARMED, { option: 'approach' }), 'approach') as unknown as {
      readonly unverified: readonly string[];
    };
    expect(out.unverified.join('\n')).toContain('shortest and most direct route');
    expect(out.unverified.join('\n')).not.toContain('fastest available means');
  });
});

// — Thaumaturgy, six wonders ————————————————————————————————————————————————

describe('Thaumaturgy works the wonder its caster named', () => {
  const work = (option: string, log: readonly GameEvent[] = ARMED) =>
    resolveSpell(
      fold('seed', log),
      CLERIC,
      { spellId: 'thaumaturgy', targets: [], option } as never,
      supply(FAILS),
    );

  it('hands the named wonder over and not the other five', () => {
    const out = unwrap(work('phantom-sound'), 'wonder') as {
      readonly unverified: readonly string[];
    };
    expect(out.unverified.join('\n')).toContain('rumble of thunder');
    expect(out.unverified.join('\n')).not.toContain('flicker');
  });

  it('a fourth wonder ends the first', () => {
    let log = ARMED;
    for (const option of ['altered-eyes', 'fire-play', 'tremors']) {
      const out = unwrap(work(option, log), 'wonder') as { readonly events: readonly GameEvent[] };
      log = [...log, ...out.events];
    }
    expect(Object.keys(fold('seed', log).ongoing)).toHaveLength(3);

    const fourth = unwrap(work('booming-voice', log), 'wonder') as {
      readonly events: readonly GameEvent[];
    };
    log = [...log, ...fourth.events];
    const running = Object.values(fold('seed', log).ongoing);
    expect(running).toHaveLength(3);
    expect(running.some((one) => one.option === 'altered-eyes')).toBe(false);
  });
});

// — what the validator refuses ——————————————————————————————————————————————

describe('the validator holds a branch to saying what it is', () => {
  const definition = (options: unknown): unknown => ({
    id: 'homebrew-word',
    name: 'Homebrew Word',
    level: 1,
    school: 'enchantment',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'ranged', feet: 60 },
    targets: { count: 1 },
    effects: [],
    options,
  });
  const codes = (value: unknown) =>
    checkSpellDefinitionValue(value).map((problem) => problem.code);

  const HALT = {
    label: 'Halt',
    effects: [{ kind: 'save', ability: 'wis', condition: 'prone', outlivesCasting: true }],
  };

  it('refuses a record of one branch', () => {
    expect(codes(definition({ halt: HALT }))).toContain('one_option');
  });

  it('refuses a branch that says nothing at all', () => {
    expect(
      codes(definition({ halt: HALT, hush: { label: 'Hush', effects: [] } })),
    ).toContain('option_says_nothing');
  });

  it('accepts a branch whose list is empty but which hands its sentence over', () => {
    expect(
      codes(
        definition({
          halt: HALT,
          hush: { label: 'Hush', effects: [], handsOver: ['the target says nothing'] },
        }),
      ),
    ).toEqual([]);
  });

  /**
   * The casting sizes its target list, measures a swing and demands a stated
   * weapon off the spell's **own** effects, before it knows which branch it is
   * running — so a roll written inside a branch is one nobody made room for.
   */
  it('refuses an effect the casting settles before it reads the branch', () => {
    expect(
      codes(
        definition({
          halt: HALT,
          hurl: {
            label: 'Hurl',
            effects: [
              { kind: 'attack', attack: 'ranged', damage: { dice: '1d8' }, damageType: 'force' },
            ],
          },
        }),
      ),
    ).toContain('option_effect_settled_early');
  });

  it('refuses a drop that is neither the casting’s object nor all of them', () => {
    expect(
      codes(
        definition({
          halt: HALT,
          shake: {
            label: 'Shake',
            effects: [{ kind: 'save', ability: 'wis', drops: { all: 'yes' } }],
          },
        }),
      ),
    ).toContain('malformed_field');
  });

  it('checks a branch’s effects like any other', () => {
    expect(
      codes(
        definition({
          halt: HALT,
          hush: { label: 'Hush', effects: [{ kind: 'save', ability: 'wis' }] },
        }),
      ),
    ).toContain('save_imposes_nothing');
  });
});
