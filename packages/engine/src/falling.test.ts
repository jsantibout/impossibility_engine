import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng } from './dice.js';
import { fold, type GameEvent } from './events.js';
import { spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { declaredCasting } from './spellcasting.js';
import { declareFalling, reactionOpportunities, resolveFall, resolveSpell } from './commands.js';
import { spellOn } from './fold/release.js';

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

    // The casting is a thing with an identity, and it is on the creature the
    // caller named — through the ward it hung rather than through `aimed`,
    // which holds only what the world cannot say. `spellOn` unions the two.
    const record = Object.values(after.ongoing).find((one) => one.spellId === 'feather-fall');
    expect(record).toBeDefined();
    expect(spellOn(after, record!)).toEqual([CLIMBER]);

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

// — what the landing costs a warded creature ————————————————————————————————

/**
 * SRD *Feather Fall*: "If a creature lands before the spell ends, the creature
 * takes **no damage** from the fall, and the spell ends for that creature."
 *
 * The half the `falling` shape was still waiting on, and it is two sentences
 * rather than one: the landing costs nothing, and the spell stops — for **that
 * creature**, while it runs on for the other four the casting caught.
 *
 * **No damage is not a roll that came to nothing.** The dice are not thrown
 * at all, which is observable from outside: a roll the engine issues moves the
 * generator and leaves a `rolls-issued` behind, so a warded landing that threw
 * 20d6 and subtracted them would be a different log from this one.
 */
describe('a warded creature pays nothing for landing', () => {
  const FELL = 60;

  /** The climber, falling, with the spell on them. */
  const warded = (targets: readonly CharacterId[] = [CLIMBER]): readonly GameEvent[] => {
    const declared = falls(FIGHTING);
    const cast = unwrap(castFeatherFall(declared, targets), 'feather fall');
    return [...declared, ...cast.events];
  };

  const land = (log: readonly GameEvent[], who: CharacterId = CLIMBER) =>
    unwrap(resolveFall(fold('s', log), who, { feet: FELL }, supply()), `${who} landing`);

  it('hangs the ward on the creature the casting caught', () => {
    const state = fold('s', warded());
    expect(state.creatures[CLIMBER]?.fallWards.map((ward) => ward.source)).toHaveLength(1);
    expect(state.creatures[THUG]?.fallWards).toEqual([]);
  });

  it('turns a sixty-foot fall into no damage at all', () => {
    const landed = land(warded());
    expect(landed.damage).toBe(0);
    expect(landed.dice).toBeNull();
  });

  /**
   * SRD ties the Prone to having paid — "**unless** you avoid taking damage
   * from the fall ... You **then** have the Prone condition" — so a creature
   * that avoided it lands on its feet.
   */
  it('leaves the lander standing', () => {
    const log = warded();
    const landed = land(log);
    expect(landed.prone).toBe(false);
    expect(fold('s', [...log, ...landed.events]).creatures[CLIMBER]?.conditions.conditions).toEqual(
      [],
    );
  });

  /** And throws nothing: the generator does not move for a landing that cost nothing. */
  it('throws no dice for it', () => {
    const landed = land(warded());
    expect(landed.events.some((event) => event.type === 'rolls-issued')).toBe(false);
    expect(landed.events.some((event) => event.type === 'damage-taken')).toBe(false);
  });

  it('ends the spell for the creature that landed', () => {
    const log = warded();
    const landed = land(log);
    expect(
      landed.events.filter((event) => event.type === 'spell-ended' && event.on === CLIMBER),
    ).toHaveLength(1);

    const after = fold('s', [...log, ...landed.events]);
    expect(after.creatures[CLIMBER]?.fallWards).toEqual([]);
  });

  /**
   * **And runs on for the other one**, which is the reason the ward is hung
   * per creature rather than on the casting: one of five landing must not take
   * the spell away from the four still in the air.
   */
  it('leaves the casting running for everybody else it caught', () => {
    const both = [
      ...falls(FIGHTING),
      ...unwrap(declareFalling(fold('s', falls(FIGHTING)), THUG), 'the thug falls'),
    ];
    const cast = unwrap(
      resolveSpell(
        fold('s', both),
        MAGE,
        { spellId: 'feather-fall', targets: [CLIMBER, THUG], slotLevel: 1 },
        supply(),
      ),
      'feather fall on two',
    );
    const log = [...both, ...cast.events];
    const landed = land(log);
    const after = fold('s', [...log, ...landed.events]);

    const record = Object.values(after.ongoing).find((one) => one.spellId === 'feather-fall');
    expect(record).toBeDefined();
    expect(after.creatures[THUG]?.fallWards).toHaveLength(1);
    expect(after.creatures[CLIMBER]?.fallWards).toEqual([]);
    expect(spellOn(after, record!)).toEqual([THUG]);
  });

  /**
   * **A short landing is still a landing**, which is the clause the ending
   * hangs on: SRD ends the spell "if a creature **lands** before the spell
   * ends", and says nothing about how far it fell. A drop of five feet costs
   * nothing whoever takes it, so the only observable half is the ending — and
   * a ward left standing there would be a spell going on paying for every
   * later fall of a minute it had already spent.
   */
  it('ends the spell for a creature that lands from a drop too short to hurt', () => {
    const log = warded();
    const landed = unwrap(
      resolveFall(fold('s', log), CLIMBER, { feet: 5 }, supply()),
      'a short landing',
    );
    expect(landed.damage).toBe(0);
    expect(
      landed.events.filter((event) => event.type === 'spell-ended' && event.on === CLIMBER),
    ).toHaveLength(1);
    expect(fold('s', [...log, ...landed.events]).creatures[CLIMBER]?.fallWards).toEqual([]);
  });

  /** And an unwarded short landing still ends nothing and costs nothing. */
  it('leaves a short landing alone where no ward was hung', () => {
    const log = falls(FIGHTING);
    const landed = unwrap(
      resolveFall(fold('s', log), CLIMBER, { feet: 5 }, supply()),
      'a short landing',
    );
    expect(landed.damage).toBe(0);
    expect(landed.events.filter((event) => event.type === 'spell-ended')).toEqual([]);
  });

  /** The control: a faller nobody warded pays the book's price. */
  it('leaves an unwarded faller paying the dice', () => {
    const landed = land(falls(FIGHTING));
    expect(landed.dice).toBe('6d6');
    expect(landed.damage).toBeGreaterThan(0);
    expect(landed.prone).toBe(true);
  });

  /** Derived from the log alone, like everything else. */
  it('folds to the same state from the log alone', () => {
    const log = warded();
    const landed = land(log);
    const whole = [...log, ...landed.events];
    expect(fold('s', JSON.parse(JSON.stringify(whole)) as GameEvent[])).toEqual(fold('s', whole));
  });
});
