/**
 * A Hit Point maximum a Long Rest gives back.
 *
 * > SRD rules glossary, Long Rest, *Regain All HP*: "You regain all lost Hit
 * > Points and all spent Hit Point Dice. **If your Hit Point maximum was
 * > reduced, it returns to normal.**"
 *
 * That last sentence is a rule about **the rest** rather than about any line
 * that lowers a maximum — a Specter's Life Drain, a Wraith's, a Wight's — so
 * it lives in the rest and not in the three commands that write the lowering.
 * Until it did, every drain in the book was permanent, and a level 5 party
 * that met a Specter lost those hit points for the rest of the campaign.
 *
 * The other half of the rule is what the rest **leaves alone**: an adjustment
 * that *raises* a maximum belongs to the casting that raised it — SRD Aid —
 * and keeps that casting's lifetime. A night's sleep does not dispel a spell.
 */
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  forcePrintedSave,
  placeCreatureInScene,
  resolveAttack,
  resolveSpell,
  resolveTurn,
  setScene,
} from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { castingSource } from './spells.js';
import { declaredCasting } from './spellcasting.js';
import { hours, HOUR } from './time.js';
import { beginRest, endRest } from './rest.js';

const id = (s: string): CharacterId => asCharacterId(s);
const BREN = id('bren');
const FOE = id('foe');
const SECOND = id('second');
const CLERIC = id('cleric');
const ALLY = id('ally');

const SEED = 'drain';

const supply = (seed = SEED) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** A log built out of what the engine produced, plus the clock. */
class Table {
  constructor(readonly log: GameEvent[] = []) {}

  get state(): GameState {
    return fold(SEED, this.log);
  }

  /** A command returning a bare batch. */
  do(step: string, produce: (state: GameState) => Result<readonly GameEvent[]>): GameState {
    this.log.push(...unwrap(produce(this.state), step));
    return this.state;
  }

  /** A command returning a resolution with a batch inside it. */
  did(
    step: string,
    produce: (state: GameState) => Result<{ readonly events: readonly GameEvent[] }>,
  ): GameState {
    this.log.push(...unwrap(produce(this.state), step).events);
    return this.state;
  }

  raw(...events: readonly GameEvent[]): GameState {
    this.log.push(...events);
    return this.state;
  }
}

const hp = (state: GameState, who: CharacterId): number => state.creatures[who]!.vitals.hp;
const hpMax = (state: GameState, who: CharacterId): number => state.creatures[who]!.vitals.hpMax;
const maxima = (state: GameState, who: CharacterId) => state.creatures[who]!.hitPointMaxima;

const clock = (seconds: number, reason = 'the night'): GameEvent => ({
  type: 'time-advanced',
  seconds,
  reason,
});

/** A whole rest, from lying down to waking up. */
function sleep(table: Table, who: CharacterId, kind: 'short' | 'long', takes: number): GameState {
  table.do(`${who} lies down for a ${kind} rest`, (s) => beginRest(s, who, kind, `${kind}:${who}`));
  table.raw(clock(takes));
  return table.did(`${who} wakes from the ${kind} rest`, (s) =>
    endRest(s, who, { commandId: `end-${kind}:${who}` }),
  );
}

// — a drain a blow deals ——————————————————————————————————————————————————————

/** A level 1 Fighter, Medium, for the undead to drain. */
const walkOn = (): CharacterChoices => ({
  name: 'Bren',
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
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'archery' },
  },
});

/** The fighter, the undead things, and a fight with the undead acting first. */
function graveyard(...blocks: readonly string[]): Table {
  const table = new Table();
  const who = [FOE, SECOND];
  table.do('the fighter arrives', () => createCharacter(SRD_CONTENT, walkOn(), BREN));
  // Four levels of Fighter later. A level 1 character has fewer hit points
  // than a Specter's Life Drain deals, and a drain that also kills is a test
  // about dying; this is a test about waking up.
  table.raw({ type: 'hit-point-maximum-raised', id: BREN, amount: 40 });
  blocks.forEach((block, index) => {
    table.did(`the ${block} arrives`, (s) => addCreature(s, SRD_CONTENT, who[index]!, block));
  });
  table.do('the graveyard', (s) => setScene(s, { width: 200, depth: 200, height: 40 }));
  table.do('the headstone', (s) => addSceneLandmark(s, 'the headstone', { x: 90, y: 90, z: 0 }));
  table.do('Bren by the headstone', (s) =>
    placeCreatureInScene(s, BREN, { from: { landmark: 'the headstone' }, feet: 0 }),
  );
  blocks.forEach((_, index) => {
    table.do(`the undead at ${index}`, (s) =>
      placeCreatureInScene(s, who[index]!, {
        from: { creature: BREN },
        feet: 5,
        bearing: 180 - index * 90,
      }),
    );
  });
  table.do('Bren’s side', (s) => declareCreatureSide(s, BREN, 'party'));
  blocks.forEach((_, index) => {
    table.do(`the undead’s side at ${index}`, (s) => declareCreatureSide(s, who[index]!, 'wild'));
  });
  table.do('the order', (s) =>
    beginCombat(s, [
      ...blocks.map((_, index) => ({ id: who[index]!, initiative: 20 - index, speed: 30 })),
      { id: BREN, initiative: 1, speed: 30 },
    ]),
  );
  return table;
}

/** The fight over, and nobody healed: a maximum still lowered, a body able to lie down. */
function carriedHome(table: Table): GameState {
  return table.raw({ type: 'combat-ended' });
}

/** Every release the log carries, as `[who, source]`. */
const releases = (log: readonly GameEvent[]): readonly (readonly [string, string])[] =>
  log.flatMap((e) =>
    e.type === 'hit-point-maximum-restored' ? [[e.id as string, e.source] as const] : [],
  );

describe('a Hit Point maximum a Long Rest gives back', () => {
  /**
   * SRD Specter, Life Drain: "the target's Hit Point maximum decreases by an
   * amount equal to the damage taken." The blow is driven through the public
   * attack command, so what is under test is the maximum the engine actually
   * lowered and not one this test wrote down.
   */
  it('leaves a Specter’s drain standing through a Short Rest and takes it off at a Long one', () => {
    const table = graveyard('specter');
    const whole = hpMax(table.state, BREN);

    const drained = table.did('the specter drains him', (s) =>
      resolveAttack(
        s,
        FOE,
        {
          target: BREN,
          weapon: null,
          action: 'Life Drain',
          attackBonuses: [{ source: 'forced', flat: 40 }],
          commandId: 'the drain',
        },
        supply(),
      ),
    );
    const lowered = hpMax(drained, BREN);
    expect(lowered).toBeLessThan(whole);
    expect(maxima(drained, BREN)).toHaveLength(1);

    // And a parting blow, so the rest has hit points to give back as well as a
    // ceiling — otherwise the drain leaves him at his own lowered maximum and
    // the refill has nothing to prove.
    table.raw({ type: 'damage-taken', id: BREN, amount: 20 });
    expect(hp(table.state, BREN)).toBeLessThan(hpMax(table.state, BREN));

    carriedHome(table);

    // SRD prints the sentence under *Long Rest* and nowhere else: an hour by
    // the fire gives a drained maximum nothing back.
    const rested = sleep(table, BREN, 'short', HOUR);
    expect(hpMax(rested, BREN)).toBe(lowered);
    expect(maxima(rested, BREN)).toHaveLength(1);
    expect(releases(table.log)).toEqual([]);

    const woken = sleep(table, BREN, 'long', hours(8));
    expect(hpMax(woken, BREN)).toBe(whole);
    // "You regain all lost Hit Points" — at the maximum the same rest restored.
    expect(hp(woken, BREN)).toBe(whole);
    expect(maxima(woken, BREN)).toEqual([]);
    expect(releases(table.log)).toHaveLength(1);
  });

  /**
   * SRD Wight, Life Drain — the same sentence reached by a saving throw rather
   * than by an attack roll, through `forcePrintedSave`. One rule, and the rest
   * gives it back whichever command wrote it down.
   */
  it('gives back a Wight’s save-driven drain the same way', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const table = graveyard('wight');
      const whole = hpMax(table.state, BREN);
      const out = unwrap(
        forcePrintedSave(
          table.state,
          FOE,
          { line: 'Life Drain', targets: [BREN], commandId: `drain-${seed}` },
          supply(seed),
        ),
        'the wight drains him',
      );
      if (out.outcomes[0]!.save!.success) continue;
      table.raw(...out.events);
      expect(hpMax(table.state, BREN)).toBeLessThan(whole);

      carriedHome(table);
      const woken = sleep(table, BREN, 'long', hours(8));

      expect(hpMax(woken, BREN)).toBe(whole);
      expect(hp(woken, BREN)).toBe(whole);
      expect(releases(table.log)).toHaveLength(1);
      return;
    }
    throw new Error('no seed failed the save');
  });

  /**
   * Two bites are two drains — the source carries the use — and the rest takes
   * both off, because the rule is about every reduction the creature is under
   * and not about the last one.
   */
  it('takes off two drains at once', () => {
    const table = graveyard('specter', 'specter');
    const whole = hpMax(table.state, BREN);

    for (const [which, drainer] of [
      ['first', FOE],
      ['second', SECOND],
    ] as const) {
      if (which === 'second') {
        table.did('the first specter is done', (s) =>
          resolveTurn(s, supply('turn'), { commandId: 'the first is done' }),
        );
      }
      table.did(`the ${which} drain`, (s) =>
        resolveAttack(
          s,
          drainer,
          {
            target: BREN,
            weapon: null,
            action: 'Life Drain',
            attackBonuses: [{ source: 'forced', flat: 40 }],
            commandId: `the ${which} drain`,
          },
          supply(`${which}-${SEED}`),
        ),
      );
    }
    expect(maxima(table.state, BREN)).toHaveLength(2);

    carriedHome(table);
    const woken = sleep(table, BREN, 'long', hours(8));

    expect(hpMax(woken, BREN)).toBe(whole);
    expect(maxima(woken, BREN)).toEqual([]);
    expect(releases(table.log)).toHaveLength(2);
  });
});

// — a raise the rest leaves alone —————————————————————————————————————————————

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 20, cha: 10 },
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
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

/**
 * A cleric and an ally, both elves.
 *
 * SRD Trance: "You can finish a Long Rest in 4 hours." The rest has to finish
 * **inside** SRD Aid's eight hours or the spell's own deadline would end it,
 * and a test that could not tell the rest's release from the clock's expiry
 * would prove nothing about either.
 */
const CHAPEL: readonly GameEvent[] = [
  added(CLERIC, { longRestSeconds: hours(4) }),
  added(ALLY, {
    longRestSeconds: hours(4),
    stated: { armorClass: 10, proficiencyBonus: 2, initiative: 0 },
  }),
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
    spellcasting: declaredCasting({ ability: 'wis', classId: 'cleric', cantrips: [], prepared: ['aid'] }),
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the altar', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the altar' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: ALLY,
    placement: { from: { creature: CLERIC }, feet: 5, bearing: 0 },
  },
  { type: 'sight-declared', from: CLERIC, to: ALLY, seen: true },
  { type: 'sight-declared', from: ALLY, to: CLERIC, seen: true },
];

describe('a Hit Point maximum a Long Rest leaves alone', () => {
  /**
   * SRD Aid: "Each target's Hit Point maximum and current Hit Points increase
   * by 5 for the duration" — eight hours of it. The raise belongs to the
   * casting, so the night that ends a drain does not end a spell.
   */
  it('keeps a raised maximum through the night', () => {
    const table = new Table([...CHAPEL]);
    const ordinary = hpMax(table.state, ALLY);

    table.did('the cleric casts Aid', (s) =>
      resolveSpell(s, CLERIC, { spellId: 'aid', targets: [ALLY], slotLevel: 2 }, supply('aid')),
    );
    expect(hpMax(table.state, ALLY)).toBe(ordinary + 5);

    const woken = sleep(table, ALLY, 'long', hours(4));

    expect(hpMax(woken, ALLY)).toBe(ordinary + 5);
    expect(hp(woken, ALLY)).toBe(ordinary + 5);
    expect(maxima(woken, ALLY)).toHaveLength(1);
    expect(releases(table.log)).toEqual([]);
  });

  /**
   * **The sign, and not the spell.** SRD Aid reaches the rest with a casting
   * id in its source and would be left alone for that reason alone, so the
   * rule "a raise is never released" needs a raise **no casting made** to be
   * stated at all — the shape a homebrew feature that raises a maximum takes.
   * The rest gives back what was taken; it does not take back what was given.
   */
  it('keeps a raise no casting is holding up', () => {
    const table = new Table([
      ...CHAPEL,
      { type: 'hit-point-maximum-adjusted', id: ALLY, adjustment: { source: 'a gift', amount: 7 } },
    ]);
    const raised = hpMax(table.state, ALLY);

    const woken = sleep(table, ALLY, 'long', hours(4));

    expect(hpMax(woken, ALLY)).toBe(raised);
    expect(maxima(woken, ALLY)).toEqual([{ source: 'a gift', amount: 7 }]);
    expect(releases(table.log)).toEqual([]);
  });

  /**
   * **A lowering with a lifetime of its own is the deadline's.** Two owners of
   * one ending is how a grant comes to be released twice, so a reduction a
   * `grants` timer already stands over is left where it is — and the timer
   * takes it off at the moment it was written for, through the door every
   * other expiry uses.
   */
  it('leaves a lowering its own deadline is coming for', () => {
    const table = new Table([
      ...CHAPEL,
      { type: 'hit-point-maximum-adjusted', id: ALLY, adjustment: { source: 'a curse', amount: -9 } },
      {
        type: 'effect-scheduled',
        target: { kind: 'grants', on: ALLY, source: 'a curse' },
        deadline: { kind: 'elapsed', at: hours(100) },
      },
    ]);
    const cursed = hpMax(table.state, ALLY);

    const woken = sleep(table, ALLY, 'long', hours(4));
    expect(hpMax(woken, ALLY)).toBe(cursed);
    expect(releases(table.log)).toEqual([]);

    // And the deadline it was left to arrives and does the work.
    const later = table.raw(clock(hours(100), 'a hundred hours'));
    expect(hpMax(later, ALLY)).toBe(cursed + 9);
    expect(maxima(later, ALLY)).toEqual([]);
  });

  /**
   * **And a lowering a casting is holding is the casting's**, for the reason
   * the deadline's is the deadline's: `releaseCasting` is already coming for
   * it, and a rest that took it first would leave that ending holding nothing.
   *
   * **The lowering here is written by hand, because no printed spell can make
   * one.** `checkSpellDefinition` refuses a `hit-point-maximum` effect whose
   * amount is not positive, so the only castings that move a maximum today
   * move it up. What is under test is the rule and not a spell: a source with
   * a casting inside it has an owner, whichever direction it points, and the
   * casting here is a real one with a real record behind it.
   */
  it('leaves a lowering a running casting is holding up', () => {
    const table = new Table([...CHAPEL]);
    table.did('the cleric casts Aid', (s) =>
      resolveSpell(s, CLERIC, { spellId: 'aid', targets: [ALLY], slotLevel: 2 }, supply('aid')),
    );
    const cast = table.log.find((e) => e.type === 'spell-cast');
    if (cast === undefined || cast.type !== 'spell-cast') throw new Error('nothing was cast');
    const source = castingSource('aid', cast.castingId);

    const ordinary = hpMax(table.state, CLERIC);
    table.raw({
      type: 'hit-point-maximum-adjusted',
      id: CLERIC,
      adjustment: { source, amount: -6 },
    });
    expect(hpMax(table.state, CLERIC)).toBe(ordinary - 6);

    const woken = sleep(table, CLERIC, 'long', hours(4));
    expect(hpMax(woken, CLERIC)).toBe(ordinary - 6);
    expect(releases(table.log)).toEqual([]);

    // The owner it was left to, doing what it was left to do.
    const ended = table.raw({
      type: 'spell-ended',
      castingId: cast.castingId,
      on: null,
      reason: 'dispelled',
    });
    expect(hpMax(ended, CLERIC)).toBe(ordinary);
  });
});
