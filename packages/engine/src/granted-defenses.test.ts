import { readFileSync } from 'node:fs';
import { SRD_CONTENT } from '@ie/content';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { applyConditionTo, endConcentration, resolveSpell } from './commands.js';
import { forSeconds } from './time.js';
import { dealSpellDamage } from './commands/damage.js';
import { defensesOf } from './standing.js';
import { adaptMonster, conditionApplicability } from './monster.js';
import { parseMonsters, type Monster } from '@ie/srd';
import { spellOn } from './fold/release.js';

/**
 * A Resistance an effect grants, and the deadline it needs.
 *
 * `CreatureState.defenses` was written once, when the creature entered the
 * game, and nothing added to it afterwards — so every SRD spell that hands a
 * creature a Resistance was a note in `unmodelled` saying so. Three of them
 * are transcribed here:
 *
 * - SRD Stoneskin: "Until the spell ends, one willing creature you touch has
 *   Resistance to Bludgeoning, Piercing, and Slashing damage."
 * - SRD Protection from Energy: "For the duration, the willing creature you
 *   touch has Resistance to one damage type of your choice: Acid, Cold, Fire,
 *   Lightning, or Thunder."
 * - SRD Protection from Poison: "... and it has Resistance to Poison damage."
 *
 * The grant sits on the creature beside the three sourced grants that were
 * already there — `bonuses`, `armorClasses`, `rollModifiers` — and ends
 * through the one door they end through.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const FIGHTER = id('fighter');
const DRUID = id('druid');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 14, con: 16, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
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
  [1, 2, 3, 4].map((level) => ({
    type: 'resource-pool-declared',
    id: who,
    pool: {
      key: spellSlotKey(level),
      label: `level ${level} spell slot`,
      max: 4,
      recovers: 'long-rest',
    },
  }));

const PREPARED = ['stoneskin', 'protection-from-energy', 'protection-from-poison'];

const SETUP: readonly GameEvent[] = [
  added(CLERIC),
  added(FIGHTER),
  added(DRUID),
  ...slots(CLERIC),
  ...slots(DRUID),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the ford', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the ford' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: FIGHTER,
    placement: { from: { creature: CLERIC }, feet: 5, bearing: 0 },
  },
  {
    type: 'creature-placed',
    id: DRUID,
    placement: { from: { creature: CLERIC }, feet: 5, bearing: 90 },
  },
  { type: 'sight-declared', from: CLERIC, to: FIGHTER, seen: true },
  { type: 'sight-declared', from: DRUID, to: FIGHTER, seen: true },
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'cleric',
      cantrips: [],
      prepared: PREPARED,
    }),
  },
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'druid',
      cantrips: [],
      prepared: PREPARED,
    }),
  },
];

const base = (): GameState => fold('seed', SETUP);

const supply = (seed = 'cast') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>): T => unwrap(result, 'granted defences');

const applyAll = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce(applyEvent, state);

/** What a creature actually takes from one typed hit. */
const hitFor = (state: GameState, target: CharacterId, type: string, amount: number): number =>
  must(
    dealSpellDamage(
      state,
      target,
      [{ type, total: amount, flat: amount, roll: null, source: 'a test' }],
      'a test',
      supply('hit'),
      {},
    ),
  ).amount;

describe('Stoneskin grants a Resistance that ends with the spell', () => {
  /**
   * SRD: "Until the spell ends, one willing creature you touch has Resistance
   * to Bludgeoning, Piercing, and Slashing damage."
   */
  it('halves bludgeoning, piercing and slashing, and nothing else', () => {
    const cast = must(
      resolveSpell(
        base(),
        CLERIC,
        { spellId: 'stoneskin', targets: [FIGHTER], slotLevel: 4 },
        supply(),
      ),
    );
    const after = applyAll(base(), cast.events);

    expect(hitFor(after, FIGHTER, 'bludgeoning', 21)).toBe(10);
    expect(hitFor(after, FIGHTER, 'piercing', 21)).toBe(10);
    expect(hitFor(after, FIGHTER, 'slashing', 21)).toBe(10);
    // Nothing the spell does not name.
    expect(hitFor(after, FIGHTER, 'fire', 21)).toBe(21);
  });

  it('takes the Resistance away when the Concentration ends', () => {
    const cast = must(
      resolveSpell(
        base(),
        CLERIC,
        { spellId: 'stoneskin', targets: [FIGHTER], slotLevel: 4 },
        supply(),
      ),
    );
    const during = applyAll(base(), cast.events);
    expect(hitFor(during, FIGHTER, 'slashing', 21)).toBe(10);

    const ended = applyAll(during, must(endConcentration(during, CLERIC, 'voluntary')));
    expect(ended.creatures[FIGHTER]?.grantedDefenses).toEqual([]);
    expect(hitFor(ended, FIGHTER, 'slashing', 21)).toBe(21);
  });

  it('puts the casting on the creature it is protecting', () => {
    const cast = must(
      resolveSpell(
        base(),
        CLERIC,
        { spellId: 'stoneskin', targets: [FIGHTER], slotLevel: 4 },
        supply(),
      ),
    );
    const after = applyAll(base(), cast.events);
    const record = Object.values(after.ongoing)[0]!;
    expect(spellOn(after, record)).toEqual([FIGHTER]);
  });

  /**
   * **A granted defence is one of the links that keeps a casting *on* a
   * creature**, and `holdsNothingOf` is where that is read.
   *
   * `on` shrinks when the last thing a casting owns on a creature lapses. A
   * casting that also hung an independently-timed condition therefore has two
   * things there, and the condition running out must not take the spell off
   * somebody it is still protecting — a stale *absence* would make a Dispel
   * Magic aimed at them find nothing to end while the Resistance went on
   * halving.
   */
  it('stays on a creature whose separately-timed condition has lapsed', () => {
    const cast = must(
      resolveSpell(
        base(),
        CLERIC,
        { spellId: 'stoneskin', targets: [FIGHTER], slotLevel: 4 },
        supply(),
      ),
    );
    const during = applyAll(base(), cast.events);
    const castingId = cast.castingId!;

    // A condition the same casting owns, with a deadline of its own.
    const held = applyAll(
      during,
      must(
        applyConditionTo(during, FIGHTER, 'restrained', `Stoneskin#${castingId}`, [], forSeconds(6)),
      ),
    );
    expect(spellOn(held, held.ongoing[castingId]!)).toEqual([FIGHTER]);

    const later = applyEvent(held, { type: 'time-advanced', seconds: 6, reason: 'the round' });
    expect(later.creatures[FIGHTER]?.conditions.conditions).toEqual([]);
    // The Resistance is still there, so the casting is still on them.
    expect(spellOn(later, later.ongoing[castingId]!)).toEqual([FIGHTER]);
    expect(hitFor(later, FIGHTER, 'slashing', 21)).toBe(10);
  });
});

describe('Protection from Energy takes its damage type from the casting', () => {
  /**
   * SRD: "For the duration, the willing creature you touch has Resistance to
   * one damage type of your choice: Acid, Cold, Fire, Lightning, or Thunder."
   */
  const castType = (state: GameState, damageType: string) =>
    resolveSpell(
      state,
      CLERIC,
      { spellId: 'protection-from-energy', targets: [FIGHTER], slotLevel: 3, willing: [FIGHTER], damageType },
      supply(),
    );

  it('protects against the type that was named and no other', () => {
    const after = applyAll(base(), must(castType(base(), 'lightning')).events);
    expect(hitFor(after, FIGHTER, 'lightning', 21)).toBe(10);
    expect(hitFor(after, FIGHTER, 'fire', 21)).toBe(21);
  });

  /** The five printed types are the whole of the list. */
  it('refuses a type the spell does not print', () => {
    const refused = castType(base(), 'necrotic');
    if (!isErr(refused)) throw new Error('a sixth type should have been refused');
    expect(refused.code).toBe('unknown_damage_type');
  });

  /**
   * **Stated or refused, never defaulted.** Picking the first of the five
   * would be the engine answering a question the SRD asked the caster.
   */
  it('refuses to guess when no type is named', () => {
    const refused = resolveSpell(
      base(),
      CLERIC,
      { spellId: 'protection-from-energy', targets: [FIGHTER], slotLevel: 3, willing: [FIGHTER] },
      supply(),
    );
    if (!isErr(refused)) throw new Error('an unnamed type should have been refused');
    expect(refused.code).toBe('damage_type_required');
  });

  /**
   * Stoneskin prints one sentence about three types and offers no choice, so
   * naming one is refused rather than narrowing it.
   */
  it('refuses a named type on a spell that offers no choice', () => {
    const refused = resolveSpell(
      base(),
      CLERIC,
      { spellId: 'stoneskin', targets: [FIGHTER], slotLevel: 4, damageType: 'fire' },
      supply(),
    );
    if (!isErr(refused)) throw new Error('Stoneskin offers no choice of type');
    expect(refused.code).toBe('damage_type_fixed');
  });
});

describe('Protection from Poison resists the damage as well as ending the condition', () => {
  /**
   * SRD: "You touch a creature and end the Poisoned condition on it. For the
   * duration, the target has Advantage on saving throws to avoid or end the
   * Poisoned condition, and it has Resistance to Poison damage."
   */
  it('halves Poison damage for the hour', () => {
    const cast = must(
      resolveSpell(
        base(),
        CLERIC,
        { spellId: 'protection-from-poison', targets: [FIGHTER], slotLevel: 2 },
        supply(),
      ),
    );
    const after = applyAll(base(), cast.events);
    expect(hitFor(after, FIGHTER, 'poison', 21)).toBe(10);
  });
});

describe('Resistance is a boolean, not a tally', () => {
  /**
   * SRD: "multiple instances of Resistance ... to the same damage type count
   * as only one."
   */
  it('halves once when two castings grant the same Resistance', () => {
    const first = must(
      resolveSpell(
        base(),
        CLERIC,
        { spellId: 'stoneskin', targets: [FIGHTER], slotLevel: 4 },
        supply('one'),
      ),
    );
    const once = applyAll(base(), first.events);
    const second = must(
      resolveSpell(
        once,
        DRUID,
        { spellId: 'stoneskin', targets: [FIGHTER], slotLevel: 4 },
        supply('two'),
      ),
    );
    const twice = applyAll(once, second.events);

    expect(twice.creatures[FIGHTER]?.grantedDefenses).toHaveLength(2);
    expect(hitFor(twice, FIGHTER, 'slashing', 21)).toBe(10);
    expect(defensesOf(twice, FIGHTER).slashing).toMatchObject({ resistant: true });
  });

  it('leaves the other casting standing when one of the two ends', () => {
    const first = must(
      resolveSpell(
        base(),
        CLERIC,
        { spellId: 'stoneskin', targets: [FIGHTER], slotLevel: 4 },
        supply('one'),
      ),
    );
    const once = applyAll(base(), first.events);
    const second = must(
      resolveSpell(
        once,
        DRUID,
        { spellId: 'stoneskin', targets: [FIGHTER], slotLevel: 4 },
        supply('two'),
      ),
    );
    const twice = applyAll(once, second.events);

    const ended = applyAll(twice, must(endConcentration(twice, CLERIC, 'voluntary')));
    expect(ended.creatures[FIGHTER]?.grantedDefenses).toHaveLength(1);
    expect(hitFor(ended, FIGHTER, 'slashing', 21)).toBe(10);
  });
});

/**
 * A stat block's *qualified* entries are not unconditional, and a grant does
 * not make them so.
 *
 * `conditionApplicability` answers three ways rather than two because "except
 * from its vampire master" is a rule the engine cannot evaluate. Granting a
 * defence adds an unconditional one beside it and must leave that alone.
 */
describe('a granted defence does not flatten a qualified one', () => {
  const SPAWN = id('spawn');

  /**
   * A real stat block, with one qualified entry put on it.
   *
   * The Zombie prints an unconditional Poison resistance line the engine reads
   * into the automatic table; the qualification is the one `monster.test.ts`
   * already uses, because SRD prints it on a creature `monsters-A-Z.md` does
   * not carry.
   */
  const bestiary = parseMonsters(
    readFileSync(fileURLToPath(new URL('../../srd/raw/monsters-A-Z.md', import.meta.url)), 'utf8'),
    'monsters-A-Z.md',
  ).items;

  const spawn = (): Monster => {
    const zombie = bestiary.find((m) => m.id === 'zombie');
    if (zombie === undefined) throw new Error('no zombie in the bestiary');
    return {
      ...zombie,
      resistances: ['Necrotic'],
      immunities: ['Charmed (except from its vampire master)'],
    };
  };

  it('keeps the qualification needing adjudication while the grant is unconditional', () => {
    const adapted = adaptMonster(spawn(), SPAWN);
    // The qualified entry never reached the automatic table, and still does not.
    expect(adapted.defenses.byDamageType.charmed).toBeUndefined();
    expect(conditionApplicability(adapted, 'charmed').kind).toBe('needs-adjudication');

    const world = fold('seed', [
      ...SETUP,
      {
        type: 'creature-added',
        id: SPAWN,
        name: 'Vampire Spawn',
        sheet: adapted.sheet,
        maxHp: 82,
        diesAtZero: true,
        creatureType: 'Undead',
        defenses: adapted.defenses.byDamageType,
      },
      { type: 'sight-declared', from: CLERIC, to: SPAWN, seen: true },
      {
        type: 'creature-placed',
        id: SPAWN,
        placement: { from: { creature: CLERIC }, feet: 5, bearing: 180 },
      },
    ]);

    // A granted Immunity is unconditional by construction and sits beside the
    // stat block's own Resistance without disturbing it.
    const granted = applyEvent(world, {
      type: 'damage-defense-granted',
      id: SPAWN,
      defense: { source: 'a test', damageTypes: ['fire'], defense: 'immune' },
    });
    expect(hitFor(granted, SPAWN, 'fire', 21)).toBe(0);
    expect(hitFor(granted, SPAWN, 'necrotic', 21)).toBe(10);
    expect(conditionApplicability(adaptMonster(spawn(), SPAWN), 'charmed').kind).toBe(
      'needs-adjudication',
    );
  });
});

/**
 * Releasing a casting **on one creature** takes its defence too.
 *
 * `releaseOnTarget` is the other door, and it is the one this repository has
 * already been caught by: it computed the surviving bonuses and never applied
 * them, from the day it was written, because every spell that released on one
 * target hung a *condition* and nothing noticed. A granted defence is in
 * exactly that position now, so it is driven rather than assumed.
 *
 * The event is folded directly because no registered spell reaches it: all
 * three that grant a defence take one target, and `resolveEffects` writes
 * `on: null` for a casting that caught one creature — "a spell on this
 * creature and nobody else has nothing left to be". A multi-target grant is
 * what would reach it through a command, and none exists.
 */
describe('a casting released on one creature loses its defence there', () => {
  it('ends the Resistance and the deadline it had of its own', () => {
    const cast = must(
      resolveSpell(
        base(),
        CLERIC,
        { spellId: 'stoneskin', targets: [FIGHTER], slotLevel: 4 },
        supply(),
      ),
    );
    const during = applyAll(base(), cast.events);
    const castingId = cast.castingId!;
    const source = during.creatures[FIGHTER]!.grantedDefenses[0]!.source;

    const scheduled = applyEvent(during, {
      type: 'effect-scheduled',
      target: { kind: 'grants', on: FIGHTER, source },
      deadline: { kind: 'elapsed', at: 600 },
    });

    const released = applyEvent(scheduled, {
      type: 'spell-ended',
      castingId,
      on: FIGHTER,
      reason: 'dispelled',
    });

    expect(released.creatures[FIGHTER]?.grantedDefenses).toEqual([]);
    expect(hitFor(released, FIGHTER, 'slashing', 21)).toBe(21);
    expect(JSON.stringify(released.timers)).not.toContain('grants');
  });
});

/**
 * The fourth `EffectTarget` member, driven end to end.
 *
 * SRD Superior Hunter's Defense — "When you take damage, you can take a
 * Reaction to give yourself Resistance to that damage and any other damage of
 * the same type **until the end of the current turn**" — is the feature that
 * wants this, and it needs more than the grant and the deadline (see the
 * completion digest). What the member says is complete without it: a grant a
 * source made on a creature, ending on a deadline of its own rather than with
 * whatever made it.
 *
 * `source` rather than a casting id, so a feature and a casting use the same
 * member. One member rather than four, so a timer needs no per-grant-kind
 * identity.
 */
describe('a grant can end before the thing that made it does', () => {
  it('expires a feature grant on its own deadline', () => {
    const world = applyAll(base(), [
      {
        type: 'damage-defense-granted',
        id: FIGHTER,
        defense: {
          source: "ranger:superior-hunters-defense",
          damageTypes: ['fire'],
          defense: 'resistant',
        },
      },
      {
        type: 'effect-scheduled',
        target: { kind: 'grants', on: FIGHTER, source: "ranger:superior-hunters-defense" },
        deadline: { kind: 'elapsed', at: 6 },
      },
    ]);
    expect(hitFor(world, FIGHTER, 'fire', 21)).toBe(10);

    const later = applyEvent(world, { type: 'time-advanced', seconds: 6, reason: 'the round' });
    expect(later.creatures[FIGHTER]?.grantedDefenses).toEqual([]);
    expect(hitFor(later, FIGHTER, 'fire', 21)).toBe(21);
  });

  it('expires a casting’s grant and leaves the casting running', () => {
    const cast = must(
      resolveSpell(
        base(),
        CLERIC,
        { spellId: 'stoneskin', targets: [FIGHTER], slotLevel: 4 },
        supply(),
      ),
    );
    const during = applyAll(base(), cast.events);
    const source = during.creatures[FIGHTER]?.grantedDefenses[0]?.source;
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

    expect(later.creatures[FIGHTER]?.grantedDefenses).toEqual([]);
    expect(hitFor(later, FIGHTER, 'slashing', 21)).toBe(21);
    // The casting is untouched: the Cleric is still concentrating on it.
    expect(later.creatures[CLERIC]?.concentration).not.toBeNull();
    expect(Object.keys(later.ongoing)).toHaveLength(1);
  });

  it('takes the timer with the casting when the casting ends first', () => {
    const cast = must(
      resolveSpell(
        base(),
        CLERIC,
        { spellId: 'stoneskin', targets: [FIGHTER], slotLevel: 4 },
        supply(),
      ),
    );
    const during = applyAll(base(), cast.events);
    const source = during.creatures[FIGHTER]!.grantedDefenses[0]!.source;

    const scheduled = applyEvent(during, {
      type: 'effect-scheduled',
      target: { kind: 'grants', on: FIGHTER, source },
      deadline: { kind: 'elapsed', at: 600 },
    });
    const ended = applyAll(scheduled, must(endConcentration(scheduled, CLERIC, 'voluntary')));

    expect(JSON.stringify(ended.timers)).not.toContain('grants');
    expect(ended.creatures[FIGHTER]?.grantedDefenses).toEqual([]);
  });
});
