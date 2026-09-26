import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, isNeedsContext, expect as unwrap } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { hasCondition } from './conditions.js';
import { fold, type GameEvent } from './events.js';
import { movementLeftFor } from './standing.js';
import { standUp } from './commands.js';

/**
 * Getting up off the floor.
 *
 * SRD Prone: "_Restricted Movement._ Your only movement options are to crawl
 * or to spend an amount of movement equal to half your Speed (round down) to
 * right yourself and thereby end the condition. If your Speed is 0, you can't
 * right yourself."
 *
 * Before this there was **no way to stand up at all**. A creature knocked
 * Prone by a Shove, a Topple, a fall, a Gorgon's charge or Hideous Laughter
 * stayed there until a DM ruled it over with `liftConditionFrom` — a command
 * for a *ruling*, which is the wrong instrument twice: it charges nothing, and
 * it makes the commonest legal act in the game something only the table can
 * perform. So the price the glossary prints is charged, out of the same budget
 * a walk comes out of, and the condition ends through the door every condition
 * ends by.
 *
 * **What it is not:** an action. Standing up costs movement and nothing else —
 * no Action, no Bonus Action — which is why it spends through `spendMovement`
 * and emits no `action-spent`. Out of combat there is no budget to draw on and
 * the creature simply stands, exactly as `resolveEffectCheck` spends no Action
 * where there is no economy.
 */

const id = (s: string) => asCharacterId(s);
const FIGHTER = id('fighter');
const SLUG = id('slug');

const sheet = (baseSpeed = 30): CharacterSheet => ({
  level: 3,
  abilities: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed,
  spellcastingAbility: null,
});

const added = (who = FIGHTER, baseSpeed = 30): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(baseSpeed),
  maxHp: 30,
  diesAtZero: true,
  creatureType: 'Humanoid',
  side: 'party',
});

const FLOORED = 'the shove';

const floored = (who = FIGHTER): GameEvent => ({
  type: 'condition-applied',
  id: who,
  condition: 'prone',
  source: FLOORED,
});

/** One Prone fighter, on their own turn, with thirty feet of Speed. */
const fighting = (
  over: { readonly speed?: number; readonly spent?: number; readonly prone?: boolean } = {},
): readonly GameEvent[] => {
  const speed = over.speed ?? 30;
  return [
    added(FIGHTER, speed),
    { type: 'combat-started', combatants: [{ id: FIGHTER, initiative: 20, speed }] },
    ...(over.prone === false ? [] : [floored()]),
    ...(over.spent === undefined
      ? []
      : [{ type: 'movement-spent', id: FIGHTER, feet: over.spent } as GameEvent]),
  ];
};

describe('standing up', () => {
  it('costs half the creature’s Speed and ends the condition', () => {
    const log = fighting();
    const before = fold('s', log);
    expect(movementLeftFor(before, FIGHTER)).toBe(30);

    const events = unwrap(standUp(before, FIGHTER), 'stand');
    expect(events.map((e) => e.type)).toEqual(['movement-spent', 'condition-removed']);
    expect(events[0]).toMatchObject({ type: 'movement-spent', id: FIGHTER, feet: 15 });

    const after = fold('s', [...log, ...events]);
    expect(hasCondition(after.creatures[FIGHTER]!.conditions, 'prone')).toBe(false);
    expect(movementLeftFor(after, FIGHTER)).toBe(15);
  });

  /** "Round down": twenty-five feet of Speed is twelve, not twelve and a half. */
  it('rounds the price down', () => {
    const events = unwrap(standUp(fold('s', fighting({ speed: 25 })), FIGHTER), 'stand');
    expect(events[0]).toMatchObject({ feet: 12 });
  });

  it('is refused with ten feet left of a thirty-foot Speed', () => {
    const out = standUp(fold('s', fighting({ spent: 20 })), FIGHTER);
    expect(isErr(out) && out.code).toBe('not_enough_movement');
  });

  /** SRD: "If your Speed is 0, you can't right yourself." */
  it('is refused outright at a Speed of 0', () => {
    const out = standUp(fold('s', fighting({ speed: 0 })), FIGHTER);
    expect(isErr(out) && out.code).toBe('cannot_stand');
    expect(isErr(out) && out.reason).toMatch(/Speed of 0/);
  });

  it('is refused for a creature that is not Prone', () => {
    const out = standUp(fold('s', fighting({ prone: false })), FIGHTER);
    expect(isErr(out) && out.code).toBe('not_prone');
  });

  /** No budget to draw on, so no movement is spent and the creature stands. */
  it('stands for free outside a fight', () => {
    const log = [added(), floored()];
    const events = unwrap(standUp(fold('s', log), FIGHTER), 'stand');
    expect(events.map((e) => e.type)).toEqual(['condition-removed']);
    expect(hasCondition(fold('s', [...log, ...events]).creatures[FIGHTER]!.conditions, 'prone')).toBe(
      false,
    );
  });

  /** Every reason the creature is on the floor goes: the condition ends. */
  it('ends every instance of the condition at once', () => {
    const log: readonly GameEvent[] = [
      ...fighting(),
      { type: 'condition-applied', id: FIGHTER, condition: 'prone', source: 'the grease' },
    ];
    const events = unwrap(standUp(fold('s', log), FIGHTER), 'stand');
    expect(hasCondition(fold('s', [...log, ...events]).creatures[FIGHTER]!.conditions, 'prone')).toBe(
      false,
    );
  });

  it('asks about a creature nobody has added', () => {
    const out = standUp(fold('s', fighting()), SLUG);
    expect(isNeedsContext(out)).toBe(true);
    expect(out.ok ? null : out.code).toBe('unknown_creature');
  });

  it('is idempotent under its command id', () => {
    const log = fighting();
    const first = unwrap(standUp(fold('s', log), FIGHTER, { commandId: 'up-1' }), 'first');
    const after = fold('s', [...log, ...first]);
    expect(unwrap(standUp(after, FIGHTER, { commandId: 'up-1' }), 'retry')).toEqual([]);
  });
});
