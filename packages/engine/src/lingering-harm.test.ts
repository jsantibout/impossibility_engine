/**
 * **Harm that outlasts the fight** — M-LINGER.
 *
 * Four printed hits whose damage is the least of what they do:
 *
 * - SRD Death Dog, Bite: "_First Failure:_ The target has the Poisoned
 *   condition. While Poisoned, the target's Hit Point maximum doesn't return to
 *   normal when finishing a Long Rest, and it repeats the save every 24 hours
 *   that elapse, ending the effect on itself on a success. _Subsequent
 *   Failures:_ The Poisoned target's Hit Point maximum decreases by 5 (1d10)."
 * - SRD Mummy, Rotting Fist: "If the target is a creature, it is cursed. While
 *   cursed, the target can't regain Hit Points, its Hit Point maximum doesn't
 *   return to normal when finishing a Long Rest, and its Hit Point maximum
 *   decreases by 10 (3d6) every 24 hours that elapse. A creature dies and turns
 *   to dust if reduced to 0 Hit Points by this attack."
 * - SRD Otyugh, Bite: "the target has the Poisoned condition. Whenever the
 *   Poisoned target finishes a Long Rest, it is subjected to the following
 *   effect. _Constitution Saving Throw:_ DC 15. _Failure:_ The target's Hit
 *   Point maximum decreases by 5 (1d10) and doesn't return to normal until the
 *   Poisoned condition ends on the target. _Success:_ The Poisoned condition
 *   ends."
 * - SRD Incubus, Restless Touch: "the target is cursed for 24 hours or until
 *   the incubus dies. Until the curse ends, the target gains no benefit from
 *   finishing Short Rests."
 *
 * One record says all of it — a **lingering harm**, hosted by the curse or the
 * condition it lives exactly as long as — and four readers spend it: the Long
 * Rest that would give a maximum back, the Short Rest that would pay out, the
 * clock that tolls every 24 hours, and the Long Rest's end that throws a save.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  advanceTime,
  damageCreature,
  dailyTollsDue,
  declareCreatureSide,
  healCreature,
  liftConditionFrom,
  placeCreatureInScene,
  resolveAttack,
  resolveTurn,
  setScene,
  settleDailyTolls,
} from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { readPrintedRider, readPrintedRiders } from './monster.js';
import { beginRest, endRest } from './rest.js';
import { createRollIssuer } from './rolls.js';

const id = asCharacterId;
const BREN = id('bren');
const BEAST = id('beast');
const SEED = 'lingering';
const DAY = 86_400;

const supply = (seed = SEED) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** A level 1 Fighter, Medium, for the monsters to hurt. */
const walkOn = (name: string): CharacterChoices => ({
  name,
  classId: 'fighter',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['chain-mail'],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'], 'fighter:weapon-mastery': [] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'ray-of-sickness',
    },
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'archery' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

/** A log built only out of what the engine produced. */
class Table {
  readonly log: GameEvent[] = [];

  get state(): GameState {
    return fold(SEED, this.log);
  }

  do(step: string, produce: (state: GameState) => Result<readonly GameEvent[]>): GameState {
    this.log.push(...unwrap(produce(this.state), step));
    return this.state;
  }

  did(
    step: string,
    produce: (state: GameState) => Result<{ readonly events: readonly GameEvent[] }>,
  ): GameState {
    this.log.push(...unwrap(produce(this.state), step).events);
    return this.state;
  }

  copy(): Table {
    const twin = new Table();
    twin.log.push(...this.log);
    return twin;
  }
}

/**
 * A victim in a field with a monster five feet south of him, and no fight:
 * days have to be able to pass, and inside a fight the clock is the order's.
 */
const field = (block: string, victim: 'fighter' | 'knight' = 'fighter'): Table => {
  const table = new Table();
  if (victim === 'fighter') {
    table.do('the fighter arrives', () => createCharacter(SRD_CONTENT, walkOn('Bren'), BREN));
  } else {
    // A body with room for the blow: most of these hits would put a level 1
    // character on the floor, and a corpse is nobody for a curse to be about.
    table.did('the knight arrives', (s) => addCreature(s, SRD_CONTENT, BREN, victim));
  }
  table.did('the monster arrives', (s) => addCreature(s, SRD_CONTENT, BEAST, block));
  table.do('the field', (s) => setScene(s, { width: 400, depth: 400, height: 100 }));
  table.do('the oak', (s) => addSceneLandmark(s, 'the oak', { x: 200, y: 200, z: 0 }));
  table.do('Bren by the oak', (s) =>
    placeCreatureInScene(s, BREN, { from: { landmark: 'the oak' }, feet: 0 }),
  );
  table.do('the monster beside him', (s) =>
    placeCreatureInScene(s, BEAST, {
      from: { creature: BREN },
      // A Large monster fills the square beyond its own, so it stands one
      // further off and is still within five feet of its victim.
      feet: SRD_CONTENT.monsterById(block)!.size === 'large' ? 10 : 5,
      bearing: 180,
    }),
  );
  table.do('Bren’s side', (s) => declareCreatureSide(s, BREN, 'party'));
  table.do('the monster’s side', (s) => declareCreatureSide(s, BEAST, 'wild'));
  return table;
};

/** A swing with the attack roll forced to land: a miss answers nothing here. */
const swing = (table: Table, action: string, seed = SEED) =>
  unwrap(
    resolveAttack(
      table.state,
      BEAST,
      {
        target: BREN,
        weapon: null,
        action,
        attackBonuses: [{ source: 'forced', flat: 40 }],
        commandId: `the ${action} (${seed})`,
      },
      supply(seed),
    ),
    `the ${action}`,
  );

/** The first seed, out of sixty, whose swing leaves the world the test wants. */
const swingUntil = (
  block: string,
  action: string,
  wanted: (state: GameState, events: readonly GameEvent[]) => boolean,
): Table => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const table = field(block);
    const out = swing(table, action, `${block}-${attempt}`);
    table.log.push(...out.events);
    if (wanted(table.state, out.events)) return table;
  }
  throw new Error(`no ${block} ${action} reached the world the test wanted`);
};

const has = (state: GameState, condition: string): boolean =>
  state.creatures[BREN]?.conditions.conditions.includes(condition as never) ?? false;

const maximumOf = (state: GameState): number => state.creatures[BREN]!.vitals.hpMax;

/** Days pass outside the fight, in one stated span. */
const wait = (table: Table, seconds: number, why: string): GameState =>
  table.do(why, (s) => advanceTime(s, seconds, why, { commandId: why }));

/** A whole Long Rest, begun and ended, its saves thrown with the given seed. */
const sleep = (table: Table, why: string, seed = SEED): Result<{ readonly events: readonly GameEvent[] }> => {
  table.do(`${why}: lie down`, (s) => beginRest(s, BREN, 'long', `${why}: lie down`));
  wait(table, 8 * 3600, `${why}: the night`);
  return endRest(table.state, BREN, { commandId: `${why}: wake` }, supply(seed));
};

/** Settle every toll that is due, with a stated seed for the dice. */
const settle = (table: Table, seed: string) =>
  unwrap(settleDailyTolls(table.state, supply(seed), { commandId: `tolls (${seed})` }), 'the tolls');

// — reading the lines ——————————————————————————————————————————————————————————

describe('the hits that outlast the fight, read whole', () => {
  const riderOf = (block: string, line: string): string =>
    SRD_CONTENT.monsterById(block)!.actions.find((one) => one.name === line)!.attack!.rider!;

  it('reads the Mummy’s curse, what it does every day, and the dust at 0', () => {
    expect(readPrintedRiders(riderOf('mummy', 'Rotting Fist'))).toEqual({
      riders: [
        {
          kind: 'curse',
          onlyCreatures: true,
          lingers: {
            preventsHealing: true,
            withholdsMaximum: true,
            tolls: { everySeconds: DAY, decreases: { dice: '3d6', flat: 0, average: 10 } },
          },
        },
        { kind: 'on-dropping-to-zero', dies: true, turnsToDust: true },
      ],
      handedOver: [],
    });
  });

  it('reads the Incubus’s curse, its day and its death, and the rest it spoils', () => {
    expect(readPrintedRiders(riderOf('incubus', 'Restless Touch'))).toEqual({
      riders: [
        {
          kind: 'curse',
          lastsSeconds: DAY,
          endsWhenAttackerDies: true,
          lingers: { deniesShortRests: true },
        },
      ],
      handedOver: [],
    });
  });

  it('reads the Otyugh’s poison and the save every Long Rest owes', () => {
    // Five sentences and one rule: the one-shape reader reads it too, which
    // the Mummy's two rules and the Incubus's two are not.
    expect(readPrintedRider(riderOf('otyugh', 'Bite'))).toMatchObject({ kind: 'condition' });
    expect(readPrintedRider(riderOf('mummy', 'Rotting Fist'))).toBeNull();
    expect(readPrintedRider(riderOf('incubus', 'Restless Touch'))).toBeNull();
    expect(readPrintedRiders(riderOf('otyugh', 'Bite'))).toEqual({
      riders: [
        {
          kind: 'condition',
          conditions: ['poisoned'],
          lingers: {
            atLongRest: {
              ability: 'con',
              dc: 15,
              decreases: { dice: '1d10', flat: 0, average: 5 },
            },
          },
        },
      ],
      handedOver: [],
    });
  });

  /**
   * **The curse a sentence only half states is not read.** "it is cursed" with
   * nothing after it lays a mark nothing reads; the detail with no curse in
   * front of it names a lifetime that is not there.
   */
  it('hands back a curse detail with no curse in front of it', () => {
    const read = readPrintedRiders(
      'Until the curse ends, the target gains no benefit from finishing Short Rests.',
    );
    expect(read.riders).toEqual([]);
    expect(read.handedOver).toHaveLength(1);
  });
});

// — SRD Death Dog ——————————————————————————————————————————————————————————————

describe('a death dog’s poison', () => {
  const poisoned = (): Table => swingUntil('death-dog', 'Bite', (state) => has(state, 'poisoned'));

  it('poisons on a failed save, and hangs the day’s toll on the Poisoned it laid', () => {
    const table = poisoned();
    const harm = table.state.creatures[BREN]!.lingering ?? [];
    expect(harm).toHaveLength(1);
    expect(harm[0]).toMatchObject({
      by: BEAST,
      line: 'Bite',
      host: { kind: 'condition' },
      withholdsMaximum: true,
      tolls: {
        from: table.state.elapsed,
        everySeconds: DAY,
        paid: 0,
        decreases: { dice: '1d10', flat: 0 },
        save: { ability: 'con', dc: 12 },
      },
    });
    // Nothing is owed until a day has passed.
    expect(dailyTollsDue(table.state)).toEqual([]);
  });

  it('owes the save once a day has passed, and refuses the rest until it is thrown', () => {
    const table = poisoned();
    wait(table, DAY, 'a day');
    expect(dailyTollsDue(table.state)).toEqual([BREN]);
    table.do('lie down', (s) => beginRest(s, BREN, 'short', 'lie down'));
    wait(table, 3600, 'an hour');
    const refused = endRest(table.state, BREN, { commandId: 'get up' }, supply());
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('daily_toll_owed');
  });

  /**
   * Both answers, each found across seeds, because a test that only ever saw
   * one would pass against a rule that could produce only that one.
   */
  it('ends the poison on a made save, and lowers the maximum by 1d10 on a failure', () => {
    const base = poisoned();
    wait(base, DAY, 'a day');
    const before = maximumOf(base.state);
    let ended = 0;
    let lowered = 0;
    for (let attempt = 0; attempt < 40 && (ended === 0 || lowered === 0); attempt += 1) {
      const table = base.copy();
      const out = settle(table, `day-${attempt}`);
      table.log.push(...out.events);
      const after = table.state;
      // The save the toll threw, read off the log: Constitution against the
      // line's own DC 12, which is the number the outcome must follow.
      const thrown = out.events.find(
        (event) => event.type === 'roll-recorded' && / save vs Bite /.test(event.label),
      ) as { readonly total: number } | undefined;
      expect(thrown).toBeDefined();
      expect(has(after, 'poisoned')).toBe(thrown!.total < 12);
      if (has(after, 'poisoned')) {
        lowered += 1;
        const cut = before - maximumOf(after);
        expect(cut).toBeGreaterThanOrEqual(1);
        expect(cut).toBeLessThanOrEqual(10);
        // Paid for today, owed again tomorrow.
        expect(dailyTollsDue(after)).toEqual([]);
        expect(after.creatures[BREN]!.lingering![0]!.tolls!.paid).toBe(1);
      } else {
        ended += 1;
        expect(maximumOf(after)).toBe(before);
        expect(after.creatures[BREN]!.lingering ?? []).toEqual([]);
      }
    }
    expect(ended).toBeGreaterThan(0);
    expect(lowered).toBeGreaterThan(0);
  });

  it('keeps a lowered maximum through a Long Rest while Poisoned, and gives it back after', () => {
    const base = poisoned();
    wait(base, DAY, 'a day');
    const whole = maximumOf(base.state);
    let table: Table | null = null;
    for (let attempt = 0; attempt < 40 && table === null; attempt += 1) {
      const trial = base.copy();
      trial.log.push(...settle(trial, `fail-${attempt}`).events);
      if (has(trial.state, 'poisoned') && maximumOf(trial.state) < whole) table = trial;
    }
    expect(table).not.toBeNull();
    const lowered = maximumOf(table!.state);

    table!.log.push(...unwrap(sleep(table!, 'the first night'), 'the first night').events);
    expect(maximumOf(table!.state)).toBe(lowered);

    // The poison cured — by Lesser Restoration, or anything else that ends it.
    table!.do('the cure', (s) => liftConditionFrom(s, BREN, 'poisoned', undefined, { commandId: 'cure' }));
    expect(table!.state.creatures[BREN]!.lingering ?? []).toEqual([]);
    wait(table!, 16 * 3600, 'the day after');
    table!.log.push(...unwrap(sleep(table!, 'the second night'), 'the second night').events);
    expect(maximumOf(table!.state)).toBe(whole);
  });

  /**
   * "_Subsequent Failures:_ The Poisoned target's Hit Point maximum decreases
   * by 5 (1d10)." A second bite subjects the target to the same effect, and a
   * failure while the first Poisoned stands is a subsequent one: the maximum
   * pays and the poison's clock is not restarted.
   */
  it('takes 1d10 off the maximum for a failed save on a second bite, and keeps the clock', () => {
    const base = poisoned();
    wait(base, 3600, 'an hour');
    const from = base.state.creatures[BREN]!.lingering![0]!.tolls!.from;
    const whole = maximumOf(base.state);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const table = base.copy();
      table.log.push(...swing(table, 'Bite', `again-${attempt}`).events);
      if (table.state.creatures[BREN]!.vitals.dead) continue;
      const cut = whole - maximumOf(table.state);
      if (cut === 0) continue;
      expect(cut).toBeGreaterThanOrEqual(1);
      expect(cut).toBeLessThanOrEqual(10);
      expect(has(table.state, 'poisoned')).toBe(true);
      expect(table.state.creatures[BREN]!.lingering).toHaveLength(1);
      expect(table.state.creatures[BREN]!.lingering![0]!.tolls).toMatchObject({ from, paid: 0 });
      return;
    }
    throw new Error('no second bite was a subsequent failure');
  });

  /** The toll is a debt the turn order will not run past, as a limb's day is not. */
  it('refuses to end a turn while a toll is owed', () => {
    const table = poisoned();
    wait(table, DAY, 'a day');
    table.do('a fight', (s) =>
      beginCombat(s, [
        { id: BEAST, initiative: 20, speed: 40 },
        { id: BREN, initiative: 1, speed: 30 },
      ]),
    );
    const refused = resolveTurn(table.state, supply(), { commandId: 'next' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('daily_toll_owed');
    table.log.push(...settle(table, 'mid-fight').events);
    expect(resolveTurn(table.state, supply(), { commandId: 'next' }).ok).toBe(true);
  });
});

// — SRD Mummy ——————————————————————————————————————————————————————————————————

describe('a mummy’s curse', () => {
  const cursed = (): Table => {
    const table = field('mummy', 'knight');
    const out = swing(table, 'Rotting Fist', 'a glancing fist');
    table.log.push(...out.events);
    return table;
  };

  it('curses the creature it hits, and hangs the curse’s rules on the curse', () => {
    const table = cursed();
    const creature = table.state.creatures[BREN]!;
    if (creature.vitals.dead) throw new Error('this seed kills Bren; choose another');
    expect(creature.curses).toEqual([
      { source: expect.stringContaining('Rotting Fist'), by: BEAST, line: 'Rotting Fist' },
    ]);
    expect(creature.lingering).toHaveLength(1);
    expect(creature.lingering![0]).toMatchObject({
      host: { kind: 'curse', source: creature.curses[0]!.source },
      withholdsMaximum: true,
      tolls: { everySeconds: DAY, paid: 0, decreases: { dice: '3d6', flat: 0 } },
    });
    expect(creature.lingering![0]!.tolls!.save).toBeUndefined();
  });

  it('lets the cursed creature regain no Hit Points at all', () => {
    const table = cursed();
    const before = table.state.creatures[BREN]!.vitals.hp;
    table.do('a potion', (s) => healCreature(s, BREN, 5, { commandId: 'a potion' }));
    expect(table.state.creatures[BREN]!.vitals.hp).toBe(before);
  });

  it('takes 3d6 off the maximum every day, and no Long Rest gives it back', () => {
    const table = cursed();
    const whole = maximumOf(table.state);
    wait(table, DAY, 'a day');
    expect(dailyTollsDue(table.state)).toEqual([BREN]);
    table.log.push(...settle(table, 'the first day').events);
    const lowered = maximumOf(table.state);
    expect(whole - lowered).toBeGreaterThanOrEqual(3);
    expect(whole - lowered).toBeLessThanOrEqual(18);
    expect(dailyTollsDue(table.state)).toEqual([]);

    const hp = table.state.creatures[BREN]!.vitals.hp;
    table.log.push(...unwrap(sleep(table, 'a cursed night'), 'a cursed night').events);
    expect(maximumOf(table.state)).toBe(lowered);
    // "can't regain Hit Points" reaches the night's healing as well.
    expect(table.state.creatures[BREN]!.vitals.hp).toBe(Math.min(hp, lowered));
  });

  it('is lifted by Remove Curse, after which healing works and a Long Rest restores', () => {
    const table = cursed();
    const whole = maximumOf(table.state);
    wait(table, DAY, 'a day');
    table.log.push(...settle(table, 'the first day').events);
    const source = table.state.creatures[BREN]!.curses[0]!.source;
    // What SRD Remove Curse writes: "all curses affecting one creature … end".
    table.log.push({ type: 'printed-curse-lifted', id: BREN, source });
    expect(table.state.creatures[BREN]!.lingering ?? []).toEqual([]);
    expect(table.state.creatures[BREN]!.healingRules).toEqual([]);
    wait(table, 16 * 3600, 'the day after');
    table.log.push(...unwrap(sleep(table, 'a free night'), 'a free night').events);
    expect(maximumOf(table.state)).toBe(whole);
  });

  /**
   * A curse lifted and laid again by the same mummy, with no Long Rest
   * between, starts its days from 1 again — and the second curse's first day
   * is a second lowering, not the first one's replacement.
   */
  it('adds a second curse’s first day to the first curse’s, rather than replacing it', () => {
    const table = cursed();
    const whole = maximumOf(table.state);
    wait(table, DAY, 'a day');
    table.log.push(...settle(table, 'the first curse’s day').events);
    const first = whole - maximumOf(table.state);
    const source = table.state.creatures[BREN]!.curses[0]!.source;
    table.log.push({ type: 'printed-curse-lifted', id: BREN, source });
    table.log.push(...swing(table, 'Rotting Fist', 'a second fist').events);
    expect(table.state.creatures[BREN]!.vitals.dead).toBe(false);
    expect(table.state.creatures[BREN]!.lingering![0]!.tolls!.paid).toBe(0);
    wait(table, DAY, 'another day');
    const again = settle(table, 'the second curse’s day').events;
    table.log.push(...again);
    // What the second day threw, off the log: both days stand, summed.
    const second = again.find((event) => event.type === 'roll-recorded') as
      | { readonly total: number }
      | undefined;
    expect(second).toBeDefined();
    expect(whole - maximumOf(table.state)).toBe(first + second!.total);
  });

  it('kills the creature its blow empties, and hands the dust to the table', () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const table = field('mummy');
      const left = table.state.creatures[BREN]!.vitals.hp;
      table.do('a long day', (s) =>
        damageCreature(s, BREN, { amount: left - 1, source: 'a long day', commandId: 'wear' }),
      );
      const out = swing(table, 'Rotting Fist', `dust-${attempt}`);
      // Only a blow that would not have killed him outright: Massive Damage
      // is its own rule, and this asks about the line's.
      if ((out.damage ?? 0) - 1 >= maximumOf(table.state)) continue;
      table.log.push(...out.events);
      expect(table.state.creatures[BREN]!.vitals.dead).toBe(true);
      expect(out.unverified.join(' ')).toContain('turns to dust');
      return;
    }
    throw new Error('no fist left Bren at 0 short of Massive Damage');
  });
});

// — SRD Otyugh —————————————————————————————————————————————————————————————————

describe('an otyugh’s poison', () => {
  const bitten = (): Table => {
    const table = field('otyugh', 'knight');
    table.log.push(...swing(table, 'Bite', 'a bite he lives through').events);
    return table;
  };

  it('poisons with no span: the Long Rest’s save is what ends it', () => {
    const table = bitten();
    if (table.state.creatures[BREN]!.vitals.dead) throw new Error('this seed kills Bren');
    expect(has(table.state, 'poisoned')).toBe(true);
    wait(table, 30 * DAY, 'a month');
    expect(has(table.state, 'poisoned')).toBe(true);
    expect(table.state.creatures[BREN]!.lingering![0]).toMatchObject({
      host: { kind: 'condition' },
      atLongRest: { ability: 'con', dc: 15, decreases: { dice: '1d10', flat: 0 } },
    });
  });

  it('throws the save at every Long Rest: a failure lowers the maximum, a success ends it all', () => {
    const base = bitten();
    wait(base, 3600, 'an hour');
    const whole = maximumOf(base.state);
    let failed: Table | null = null;
    let made = 0;
    for (let attempt = 0; attempt < 60 && (failed === null || made === 0); attempt += 1) {
      const table = base.copy();
      const night = unwrap(sleep(table, 'the night', `night-${attempt}`), 'the night').events;
      table.log.push(...night);
      // The save the night threw, read off the log against the line's DC 15.
      const thrown = night.find(
        (event) => event.type === 'roll-recorded' && / save vs Bite /.test(event.label),
      ) as { readonly total: number } | undefined;
      expect(thrown).toBeDefined();
      expect(has(table.state, 'poisoned')).toBe(thrown!.total < 15);
      if (has(table.state, 'poisoned')) {
        const cut = whole - maximumOf(table.state);
        expect(cut).toBeGreaterThanOrEqual(1);
        expect(cut).toBeLessThanOrEqual(10);
        failed ??= table;
      } else {
        expect(maximumOf(table.state)).toBe(whole);
        made += 1;
      }
    }
    expect(made).toBeGreaterThan(0);
    expect(failed).not.toBeNull();

    // "doesn't return to normal until the Poisoned condition ends": the cure
    // gives it back, with no rest at all.
    const lowered = maximumOf(failed!.state);
    expect(lowered).toBeLessThan(whole);
    failed!.do('the cure', (s) => liftConditionFrom(s, BREN, 'poisoned', undefined, { commandId: 'cure' }));
    expect(maximumOf(failed!.state)).toBe(whole);
  });

  it('refuses to finish the Long Rest without a generator to throw the save', () => {
    const table = bitten();
    wait(table, 3600, 'an hour');
    table.do('lie down', (s) => beginRest(s, BREN, 'long', 'lie down'));
    wait(table, 8 * 3600, 'the night');
    const refused = endRest(table.state, BREN, { commandId: 'wake' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('no_generator');
  });
});

// — SRD Incubus ————————————————————————————————————————————————————————————————

describe('an incubus’s curse', () => {
  const touched = (): Table => {
    const table = field('incubus', 'knight');
    table.log.push(...swing(table, 'Restless Touch', 'a touch he lives through').events);
    return table;
  };

  const shortRest = (table: Table, why: string, hitDice?: readonly string[]) => {
    table.do(`${why}: sit`, (s) => beginRest(s, BREN, 'short', `${why}: sit`));
    wait(table, 3600, `${why}: the hour`);
    return endRest(
      table.state,
      BREN,
      { commandId: `${why}: stand`, ...(hitDice === undefined ? {} : { hitDice }) },
      supply(),
    );
  };

  it('curses for a day, and a finished Short Rest pays nothing', () => {
    const table = touched();
    if (table.state.creatures[BREN]!.vitals.dead) throw new Error('this seed kills Bren');
    const curse = table.state.creatures[BREN]!.curses[0]!;
    expect(curse).toMatchObject({ by: BEAST, line: 'Restless Touch', lapsesAt: table.state.elapsed + DAY, lapsesWhenDead: true });

    const rested = unwrap(shortRest(table, 'a cursed rest'), 'a cursed rest');
    expect(rested.benefit).toBe('none');
    expect(rested.events.some((e) => e.type === 'resources-restored')).toBe(false);
  });

  it('refuses the Hit Dice a cursed Short Rest would have spent', () => {
    const table = touched();
    const refused = shortRest(table, 'a cursed rest', ['hit-die:d8']);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('rest_benefit_denied');
  });

  it('lapses when the day is out, and the next Short Rest pays', () => {
    const table = touched();
    wait(table, DAY, 'a day');
    expect(table.state.creatures[BREN]!.curses).toEqual([]);
    expect(table.state.creatures[BREN]!.lingering ?? []).toEqual([]);
    expect(unwrap(shortRest(table, 'a free rest'), 'a free rest').benefit).toBe('short');
  });

  it('lapses the moment the incubus dies', () => {
    const table = touched();
    const left = table.state.creatures[BEAST]!.vitals.hp;
    table.do('the incubus falls', (s) =>
      damageCreature(s, BEAST, { amount: left, source: 'a sword', commandId: 'the sword' }),
    );
    expect(table.state.creatures[BEAST]!.vitals.dead).toBe(true);
    expect(table.state.creatures[BREN]!.curses).toEqual([]);
    expect(unwrap(shortRest(table, 'a free rest'), 'a free rest').benefit).toBe('short');
  });
});

// — what a rest's own healing meets ——————————————————————————————————————————

/**
 * A rest's hit points are regained hit points, so they meet the two rules
 * every other healing door meets: a running `prevented` rule (the Mummy's
 * curse is one) and a block that never regains any (SRD Swarm).
 */
describe('the hit points a rest pays', () => {
  it('pays a swarm none at a Long Rest, because it regains no Hit Points', () => {
    const table = new Table();
    table.did('the swarm arrives', (s) => addCreature(s, SRD_CONTENT, BEAST, 'swarm-of-crawling-claws'));
    table.do('a swat', (s) => damageCreature(s, BEAST, { amount: 10, source: 'a boot', commandId: 'swat' }));
    const hurt = table.state.creatures[BEAST]!.vitals.hp;
    table.do('settle', (s) => beginRest(s, BEAST, 'long', 'settle'));
    wait(table, 8 * 3600, 'the night');
    table.log.push(...unwrap(endRest(table.state, BEAST, { commandId: 'stir' }, supply()), 'stir').events);
    expect(table.state.creatures[BEAST]!.vitals.hp).toBe(hurt);
  });

  it('spends the Hit Die and regains nothing where healing is prevented', () => {
    const table = new Table();
    table.do('the fighter arrives', () => createCharacter(SRD_CONTENT, walkOn('Bren'), BREN));
    table.do('a cut', (s) => damageCreature(s, BREN, { amount: 6, source: 'a cut', commandId: 'cut' }));
    // What a mummy's curse hangs, written as the hit writes it.
    table.log.push({
      type: 'healing-rule-granted',
      id: BREN,
      rule: { source: 'lingering:a curse', rule: 'prevented' },
    });
    const hurt = table.state.creatures[BREN]!.vitals.hp;
    table.do('sit', (s) => beginRest(s, BREN, 'short', 'sit'));
    wait(table, 3600, 'the hour');
    const rested = unwrap(
      endRest(table.state, BREN, { commandId: 'stand', hitDice: ['hit-die:d10'] }, supply()),
      'stand',
    );
    table.log.push(...rested.events);
    expect(rested.hitDice).toHaveLength(1);
    expect(rested.events.some((event) => event.type === 'healed')).toBe(false);
    expect(table.state.creatures[BREN]!.vitals.hp).toBe(hurt);
  });
});
