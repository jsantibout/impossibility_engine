import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng } from './dice.js';
import { fold, type GameEvent } from './events.js';
import { spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { declaredCasting } from './spellcasting.js';
import { declareFalling, reactionOpportunities, resolveSpell } from './commands.js';

/**
 * A fall the engine can see.
 *
 * SRD Feather Fall is "Reaction, which you take when you or a creature you can
 * see within 60 feet of you **falls**", and nothing in the engine could say
 * that a creature was falling. Falling damage was never the blocker and
 * neither was gravity: the window could not open, because there was no fact
 * for it to read.
 *
 * So a fall is **declared**, exactly as cover, sight and a creature's type
 * are, and the window is derived from the declaration. What makes it the
 * `lastDamage` family rather than the cover family is that it is *momentary*
 * and per-creature: it stores no "until when", and the moment closes by
 * exactly the rule `damageWindowOpen` already uses — the same turn in combat,
 * the same instant on the clock outside one.
 *
 * **A creature nobody said fell is not falling**, which is a verdict and not
 * homework. `needs-context` here would be an invitation to invent a fall in
 * order to unlock a spell.
 */

const id = (s: string) => asCharacterId(s);
const MAGE = id('mage');
const CLIMBER = id('climber');
const THUG = id('thug');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 10, con: 14, int: 16, wis: 12, cha: 10 },
  skills: {},
  saveProficiencies: ['con'],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

/** A mage who can see the climber thirty feet away, with a slot to spend. */
const TABLE: readonly GameEvent[] = [
  added(MAGE, 'party'),
  added(CLIMBER, 'party'),
  added(THUG, 'foes'),
  {
    type: 'resource-pool-declared',
    id: MAGE,
    pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 3, recovers: 'long-rest' },
  },
  {
    type: 'spellcasting-declared',
    id: MAGE,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['feather-fall'] }),
  },
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 200 } },
  { type: 'creature-placed', id: MAGE, placement: { from: { sceneCenter: true }, feet: 0 } },
  {
    type: 'creature-placed',
    id: CLIMBER,
    placement: { from: { creature: MAGE }, feet: 30, bearing: 0 },
  },
  {
    type: 'creature-placed',
    id: THUG,
    placement: { from: { creature: MAGE }, feet: 20, bearing: 180 },
  },
  { type: 'sight-declared', from: MAGE, to: CLIMBER, seen: true },
  { type: 'sight-declared', from: MAGE, to: THUG, seen: true },
];

const FIGHTING: readonly GameEvent[] = [
  ...TABLE,
  {
    type: 'combat-started',
    combatants: [
      { id: THUG, initiative: 20, speed: 30 },
      { id: MAGE, initiative: 12, speed: 30 },
      { id: CLIMBER, initiative: 5, speed: 30 },
    ],
  },
];

const supply = () => ({
  issuer: createRollIssuer('r'),
  rng: createRng('falling'),
  content: SRD_CONTENT,
});

/** Somebody at the table says the climber has come off the ledge. */
const falls = (log: readonly GameEvent[], who: CharacterId = CLIMBER): readonly GameEvent[] => [
  ...log,
  ...unwrap(declareFalling(fold('s', log), who), 'a fall'),
];

const castFeatherFall = (log: readonly GameEvent[], targets: readonly CharacterId[] = [CLIMBER]) =>
  resolveSpell(
    fold('s', log),
    MAGE,
    { spellId: 'feather-fall', targets: [...targets], slotLevel: 1 },
    supply(),
  );

const LATER: GameEvent = { type: 'time-advanced', seconds: 6, reason: 'the party walks on' };

describe('a fall is a fact the table declares', () => {
  it('holds nobody falling until somebody says so', () => {
    expect(fold('s', TABLE).creatures[CLIMBER]?.falling).toBeNull();
  });

  it('records the moment and nothing about how far or how long', () => {
    const state = fold('s', falls(TABLE));
    expect(state.creatures[CLIMBER]?.falling).toEqual({ turn: null, elapsed: 0 });
  });

  it('records the turn it happened on, when there is a fight to have turns', () => {
    const state = fold('s', falls(FIGHTING));
    expect(state.creatures[CLIMBER]?.falling).toEqual({
      turn: state.combat?.turnsTaken ?? -1,
      elapsed: 0,
    });
  });

  it('refuses a creature nobody has added', () => {
    const refused = declareFalling(fold('s', TABLE), id('nobody'));
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('unknown_creature');
  });
});

describe('Feather Fall waits for a fall it can see', () => {
  /**
   * The refusal is a **verdict**: an event that did not happen is false rather
   * than unknown, and a `needs-context` here would be the engine inviting a
   * caller to declare a fall in order to unlock a spell.
   */
  it('refuses before anybody falls, and spends nothing', () => {
    const refused = castFeatherFall(FIGHTING);
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) {
      expect(refused.code).toBe('no_trigger');
      expect(refused.kind).toBe('refusal');
    }

    const state = fold('s', FIGHTING);
    expect(state.creatures[MAGE]?.resources.pools[spellSlotKey(1)]?.spent).toBe(0);
    expect(state.combat?.budgets[MAGE]?.reaction).toBe(true);
  });

  it('allows it in the same turn as the declaration', () => {
    expect(castFeatherFall(falls(FIGHTING)).ok).toBe(true);
  });

  it('refuses once the turn has moved past the moment', () => {
    const gone = [...falls(FIGHTING), { type: 'turn-advanced' } as GameEvent];
    const refused = castFeatherFall(gone);
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('no_trigger');
  });

  it('refuses once the clock has moved past it, where there are no turns', () => {
    expect(castFeatherFall(falls(TABLE)).ok).toBe(true);
    const refused = castFeatherFall([...falls(TABLE), LATER]);
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('no_trigger');
  });

  /**
   * "Choose up to five **falling** creatures within range." The trigger is the
   * moment; this is the target rule, and they are different questions — the
   * thug is standing on the floor while the climber drops past him.
   */
  it('refuses a target nobody said was falling', () => {
    const refused = castFeatherFall(falls(FIGHTING), [THUG]);
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('target_not_falling');
  });

  it('takes the falling creature beside one who is not', () => {
    const both = falls(falls(FIGHTING), THUG);
    expect(castFeatherFall(both, [CLIMBER, THUG]).ok).toBe(true);
  });
});

describe('the opportunity opens and closes on exactly that rule', () => {
  const chances = (log: readonly GameEvent[]) =>
    reactionOpportunities(fold('s', log), SRD_CONTENT).filter(
      (chance) => chance.id === 'feather-fall',
    );

  it('offers nothing while nobody is falling', () => {
    expect(chances(FIGHTING)).toEqual([]);
  });

  it('offers the spell to the caster who can answer the fall', () => {
    expect(chances(falls(FIGHTING))).toEqual([
      {
        window: 'creature-falling',
        reactor: MAGE,
        id: 'feather-fall',
        name: 'Feather Fall',
        kind: 'spell',
        costsReaction: true,
        pool: null,
        against: CLIMBER,
      },
    ]);
  });

  it('takes the offer away when the turn moves on', () => {
    expect(chances([...falls(FIGHTING), { type: 'turn-advanced' }])).toEqual([]);
  });

  it('takes it away when the clock moves on, outside a fight', () => {
    expect(chances(falls(TABLE))).toHaveLength(1);
    expect(chances([...falls(TABLE), LATER])).toEqual([]);
  });
});

describe('the whole spell, end to end through the public API', () => {
  it('declares a fall, opens the window, spends the Reaction and runs for a minute', () => {
    const declared = falls(FIGHTING);
    expect(
      reactionOpportunities(fold('s', declared), SRD_CONTENT).some(
        (chance) => chance.window === 'creature-falling',
      ),
    ).toBe(true);

    const cast = unwrap(castFeatherFall(declared), 'feather fall');
    const after = fold('s', [...declared, ...cast.events]);

    expect(cast.events.some((event) => event.type === 'reaction-spent')).toBe(true);
    expect(after.combat?.budgets[MAGE]?.reaction).toBe(false);
    expect(after.creatures[MAGE]?.resources.pools[spellSlotKey(1)]?.spent).toBe(1);

    // The casting is a thing with an identity, aimed at the creature the
    // caller named — which is the half a landing would have to reach into, on
    // the day falling damage exists to end it early.
    const record = Object.values(after.ongoing).find((one) => one.spellId === 'feather-fall');
    expect(record?.aimed).toEqual([CLIMBER]);

    // SRD "Duration: 1 minute", on the clock and nowhere else — the spell
    // hangs nothing, so the minute is the whole of what runs out.
    expect(Object.keys(after.timers)).toHaveLength(1);
    const expired = fold('s', [
      ...declared,
      ...cast.events,
      { type: 'time-advanced', seconds: 60, reason: 'the fall takes its time' },
    ]);
    expect(Object.keys(expired.timers)).toHaveLength(0);
  });
});
