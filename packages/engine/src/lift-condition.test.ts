import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  contextRequestsOf,
  expect as unwrap,
  isErr,
  isNeedsContext,
  type CharacterId,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { fold, type GameEvent } from './events.js';
import { liftConditionFrom } from './commands.js';

/**
 * Taking a condition off a creature as a command, rather than as a batch of
 * events somebody assembled.
 *
 * `endConditionsOn` has been the engine's one removal since Lay On Hands, and
 * it is a *builder*: no state, no command id, no stamp. That is right for the
 * two callers inside the engine, which are already inside a command of their
 * own — and wrong for the only other caller there could be, a DM who has
 * ruled a creature Frightened and now rules that it is over. Handing that
 * caller the builder would append events no command identified, so a retried
 * "it is over" is a second `condition-removed` nobody can tell from the first.
 *
 * So this is the builder with a command around it: the same reading of which
 * instances go, and the four things every sibling command has — a creature
 * that must exist, a stamp on the event, a retry that does nothing, and a
 * reused id that is refused.
 */

const id = (s: string) => asCharacterId(s);
const GOBLIN = id('goblin');

const sheet = (): CharacterSheet => ({
  level: 3,
  abilities: { str: 12, dex: 14, con: 12, int: 10, wis: 10, cha: 8 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 20,
  diesAtZero: true,
  creatureType: 'Humanoid',
});

const RULING = 'DM ruling: the chandelier came down on it';
const SPELL = 'Hold Person (cast:1)';

/** Frightened twice over, for two unrelated reasons. */
const twiceFrightened = (): readonly GameEvent[] => [
  added(GOBLIN),
  { type: 'condition-applied', id: GOBLIN, condition: 'frightened', source: RULING },
  { type: 'condition-applied', id: GOBLIN, condition: 'frightened', source: 'the dragon' },
];

const frightenedBy = (state: ReturnType<typeof fold>): readonly string[] =>
  state.creatures[GOBLIN]!.conditions.instances
    .filter((instance) => instance.condition === 'frightened')
    .map((instance) => instance.source)
    .sort();

describe('a DM lifts a condition they ruled', () => {
  it('takes the condition off by name, every reason for it', () => {
    const before = fold('s', twiceFrightened());
    const events = unwrap(liftConditionFrom(before, GOBLIN, 'frightened'), 'lift');
    const after = fold('s', [...twiceFrightened(), ...events]);
    expect(after.creatures[GOBLIN]!.conditions.conditions).not.toContain('frightened');
  });

  /**
   * And the other reading, which is the one a ruling actually wants. SRD's
   * own removals name a condition and no cause — that is what the blanket
   * form above is — but "the fright I imposed is over" is a claim about one
   * cause, and a dragon is still a dragon.
   */
  it('lifts only the named cause when one is named', () => {
    const before = fold('s', twiceFrightened());
    const events = unwrap(liftConditionFrom(before, GOBLIN, 'frightened', RULING), 'lift');
    const after = fold('s', [...twiceFrightened(), ...events]);
    expect(after.creatures[GOBLIN]!.conditions.conditions).toContain('frightened');
    expect(frightenedBy(after)).toEqual(['the dragon']);
  });

  it('names the cause on the event, so the fold lifts exactly it', () => {
    const before = fold('s', twiceFrightened());
    const events = unwrap(liftConditionFrom(before, GOBLIN, 'frightened', RULING), 'lift');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'condition-removed', id: GOBLIN, source: RULING });
  });

  /**
   * A condition a spell is holding up is lifted the same way, which is the
   * behaviour `endConditionsOn` already has and this inherits rather than
   * re-decides: Lesser Restoration ends a Hold Person's Paralyzed without
   * ending the casting, and a DM ruling that the paralysis is over is the
   * same event.
   */
  it('does not care whether the cause was a ruling or a casting', () => {
    const log: readonly GameEvent[] = [
      added(GOBLIN),
      { type: 'condition-applied', id: GOBLIN, condition: 'paralyzed', source: SPELL },
    ];
    const events = unwrap(liftConditionFrom(fold('s', log), GOBLIN, 'paralyzed', SPELL), 'lift');
    const after = fold('s', [...log, ...events]);
    expect(after.creatures[GOBLIN]!.conditions.conditions).not.toContain('paralyzed');
  });
});

describe('the command shape its siblings have', () => {
  it('stamps the event it emits', () => {
    const events = unwrap(
      liftConditionFrom(fold('s', twiceFrightened()), GOBLIN, 'frightened', undefined, {
        commandId: 'cmd-1',
      }),
      'lift',
    );
    expect(events[0]).toMatchObject({ command: { id: 'cmd-1' } });
  });

  it('does nothing twice under one command id', () => {
    const log = twiceFrightened();
    const first = unwrap(
      liftConditionFrom(fold('s', log), GOBLIN, 'frightened', undefined, { commandId: 'cmd-1' }),
      'first',
    );
    expect(first.length).toBeGreaterThan(0);

    const after = fold('s', [...log, ...first]);
    const retry = unwrap(
      liftConditionFrom(after, GOBLIN, 'frightened', undefined, { commandId: 'cmd-1' }),
      'retry',
    );
    expect(retry).toEqual([]);
  });

  it('refuses a command id reused for different work', () => {
    const log = twiceFrightened();
    const first = unwrap(
      liftConditionFrom(fold('s', log), GOBLIN, 'frightened', RULING, { commandId: 'cmd-1' }),
      'first',
    );
    const after = fold('s', [...log, ...first]);
    const other = liftConditionFrom(after, GOBLIN, 'frightened', 'the dragon', {
      commandId: 'cmd-1',
    });
    expect(isErr(other)).toBe(true);
    if (!isErr(other)) return;
    expect(other.code).toBe('command_id_reused');
    expect(isNeedsContext(other)).toBe(false);
  });

  /**
   * And a creature nobody has added is homework. The DM has just said this
   * thing is no longer Frightened, which is a claim that it exists — absence
   * from the record is not evidence that it does not.
   */
  it('asks about a creature nobody has declared', () => {
    const out = liftConditionFrom(fold('s', [added(GOBLIN)]), id('the-ostler'), 'frightened');
    expect(isNeedsContext(out)).toBe(true);
    const requests = contextRequestsOf(out);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests[0]!.satisfyWith).toContain('addCreature');
  });

  /**
   * Lifting a condition a creature does not have is not an error, which is
   * `endConditionsOn`'s own answer and is preserved here: the reducer finds
   * nothing and changes nothing, and a DM who says "the fear is over" about a
   * creature that was never afraid has said something true.
   */
  it('lifts a condition nobody has without refusing', () => {
    const log = [added(GOBLIN)];
    const before = fold('s', log);
    const events = unwrap(liftConditionFrom(before, GOBLIN, 'frightened'), 'lift');
    const after = fold('s', [...log, ...events]);
    expect(after.creatures[GOBLIN]!.conditions).toEqual(before.creatures[GOBLIN]!.conditions);
  });
});
