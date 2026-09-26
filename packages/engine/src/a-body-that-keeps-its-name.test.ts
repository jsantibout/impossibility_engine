import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { extendContent, loadContent, type Content } from './content.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { CorruptLogError } from './fold/common.js';
import { spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { declaredCasting } from './spellcasting.js';
import { walkerOf } from './state.js';
import {
  advanceTime,
  eligibleTargets,
  pendingCastingsOf,
  removeCreatureEverywhere,
  resolveDeclaredCast,
  resolveSpell,
} from './commands.js';

/**
 * A player character's corpse raised by SRD Animate Dead keeps its record.
 *
 * The owner, 2026-09-26: the character can come back, so the body is not
 * deleted when it rises and the destroyed Zombie leaves the character's body.
 * SRD Animate Dead: "Choose a pile of bones or a corpse of a Medium or Small
 * Humanoid within range. The target becomes an Undead creature: … a Zombie if
 * you chose a corpse". SRD Raise Dead: "you revive a dead creature if it has
 * been dead no longer than 10 days". The book prints nothing about the body
 * when the Zombie is destroyed, and the ruling reads that silence.
 *
 * **What the record is**: the whole `CreatureState` under the character's id —
 * the class, level and choices `advanceCharacter` rebuilds from, the sheet, the
 * pools, the gear, the coins and `diedAt`, which is what a revival's window
 * reads. Re-creating a character is not restoring one.
 *
 * Animate Dead's rite is a minute long, so the body is past Revivify's minute
 * before it rises: the record is for Raise Dead, Resurrection and the table,
 * and the revival that proves it is a homebrew `revive` loaded through
 * `loadContent`, the door every homebrew spell takes.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const CLERIC = id('cleric');
const PRIEST = id('priest');
const SER = id('ser');

const DAY = 24 * 60 * 60;

/** SRD Paladin Features table, Prepared Spells column, at level 5. */
const paladin: CharacterChoices = {
  name: 'Ser',
  classId: 'paladin',
  level: 5,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 10, con: 13, int: 8, wis: 12, cha: 14 },
  },
  abilityIncreases: { int: 2, wis: 1 },
  classSkills: ['athletics', 'persuasion'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Lawful Good',
  subclassId: 'oath-of-devotion',
  cantrips: [],
  preparedSpells: ['cure-wounds', 'bless', 'heroism', 'divine-favor', 'shield-of-faith', 'aid'],
  spellbook: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'paladin:fighting-style': { featId: 'defense' },
    'paladin:ability-score-improvement': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
};

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 12, con: 14, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
});

/** A thin caster: a body, a prepared list and slots — not a character. */
const caster = (who: CharacterId): readonly GameEvent[] => [
  { type: 'creature-added', id: who, name: who, sheet: sheet(), maxHp: 60, diesAtZero: false, creatureType: 'Humanoid', side: 'party' },
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({
      ability: 'wis',
      prepared: ['animate-dead', 'revivify', 'gentle-repose', 'homebrew-raising'],
    }),
  },
  ...[2, 3, 4, 5].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: spellSlotKey(level), label: `level ${level} spell slot`, max: 4, recovers: 'long-rest' },
    }),
  ),
];

/** Raise Dead's ten days, as a homebrew revival anybody could write. */
const RAISING = JSON.stringify({
  id: 'homebrew-raising',
  name: 'Homebrew Raising',
  level: 3,
  school: 'necromancy',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'touch' },
  targets: { count: 1 },
  effects: [{ kind: 'revive', within: 864_000, hitPoints: 1 }],
});

const homebrew: Content = unwrap(
  extendContent(SRD_CONTENT, { spells: [...unwrap(loadContent({ spells: [JSON.parse(RAISING)] }), 'load').spells] }),
  'extend',
);

const supply = (seed = 'grave') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: homebrew,
});

const SETUP: readonly GameEvent[] = [
  ...caster(CLERIC),
  ...caster(PRIEST),
  ...unwrap(createCharacter(SRD_CONTENT, paladin, SER), 'the paladin'),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the field', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the field' }, feet: 0 } },
  { type: 'creature-placed', id: SER, placement: { from: { creature: CLERIC }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: PRIEST, placement: { from: { creature: SER }, feet: 5, bearing: 90 } },
  { type: 'creature-died', id: SER, cause: 'an ogre’s club' },
];

class Game {
  constructor(readonly events: GameEvent[] = [...SETUP]) {}

  get state(): GameState {
    return fold('seed', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  cast(by: CharacterId, spellId: string, target: CharacterId = SER, extra: { ritual?: true } = {}) {
    const out = resolveSpell(this.state, by, {
        spellId,
        targets: [target],
        // A Ritual pays no slot and names none.
        ...(extra.ritual === true ? {} : { slotLevel: homebrew.spell(spellId)!.level }),
        ...extra,
      }, supply(spellId));
    if (out.ok) this.push(out.value.events);
    return out;
  }

  /** Declare a rite of a minute or more and leave it open. */
  declare(by: CharacterId, spellId: string, extra: { ritual?: true } = {}): string {
    unwrap(this.cast(by, spellId, SER, extra), `declare ${spellId}`);
    const open = pendingCastingsOf(this.state).find((pending) => pending.caster === by);
    if (open === undefined) throw new Error(`${by} declared nothing`);
    return open.castingId;
  }

  wait(seconds: number): this {
    return this.push(unwrap(advanceTime(this.state, seconds, 'the vigil'), 'the vigil'));
  }

  settle(castingId: string): Result<readonly GameEvent[]> {
    const out = resolveDeclaredCast(this.state, castingId, supply('settle'));
    if (!out.ok) return out;
    this.push(out.value.events);
    return { ok: true, value: out.value.events };
  }

  /** The cleric's Animate Dead on Ser, the whole minute of it. */
  animate(by: CharacterId = CLERIC): Result<readonly GameEvent[]> {
    const castingId = this.declare(by, 'animate-dead');
    this.wait(60);
    return this.settle(castingId);
  }

  /** The Zombie that was Ser, whoever the engine called it. */
  zombie(): CharacterId {
    const raised = Object.values(this.state.creatures).filter((creature) => creature.raisedFrom === SER);
    if (raised.length !== 1) throw new Error(`expected one creature raised from ${SER}, got ${raised.length}`);
    return raised[0]!.id;
  }

  spent(who: CharacterId, level: number): number {
    return this.state.creatures[who]?.resources.pools[spellSlotKey(level)]?.spent ?? 0;
  }
}

const replayed = (log: readonly GameEvent[]): GameState =>
  fold('seed', JSON.parse(JSON.stringify(log)) as GameEvent[]);

const code = (out: Result<unknown>): string | null => (isErr(out) ? out.code : null);

describe('a character’s corpse rises and keeps its record', () => {
  it('raises a Zombie where Ser lay and leaves her whole record under her id, dead and unplaced', () => {
    const g = new Game();
    const where = g.state.scene!.positions[SER];
    const before = g.state.creatures[SER]!;
    expect(before.character).not.toBeNull();

    unwrap(g.animate(), 'the rite');
    const zombie = g.zombie();
    const after = g.state.creatures[SER];

    // The Zombie stands where she lay, and knows whose body it is.
    expect(g.state.creatures[zombie]?.name).toBe('Zombie');
    expect(g.state.scene!.positions[zombie]).toEqual(where);
    expect(walkerOf(g.state, SER)).toBe(zombie);

    // Her record is all still there: what she is, what she carries, and when
    // she died — which is what a revival's window reads.
    expect(after).toBeDefined();
    expect(after!.character).toEqual(before.character);
    expect(after!.character?.level).toBe(5);
    expect(after!.sheet).toEqual(before.sheet);
    expect(after!.resources).toEqual(before.resources);
    expect(after!.inventory).toEqual(before.inventory);
    expect(after!.equipped).toEqual(before.equipped);
    expect(after!.coins).toBe(before.coins);
    expect(after!.spellcasting).toEqual(before.spellcasting);
    expect(after!.vitals.diedAt).toBe(before.vitals.diedAt);
    expect(after!.vitals.dead).toBe(true);
    // And she is not on the map twice: the Zombie is her body.
    expect(g.state.scene!.positions[SER]).toBeUndefined();
    // Nothing deleted her, so no `creature-removed` was written for her.
    expect(g.events.some((e) => e.type === 'creature-removed' && e.id === SER)).toBe(false);
    expect(replayed(g.events)).toEqual(g.state);
  });

  it('refuses Revivify on a body that walks, before the slot is spent', () => {
    const g = new Game();
    unwrap(g.animate(), 'the rite');
    const spent = g.spent(CLERIC, 3);
    const refused = g.cast(CLERIC, 'revivify');
    expect(code(refused)).toBe('body_walks');
    expect(g.spent(CLERIC, 3)).toBe(spent);
  });

  it('still refuses once the day passes and the control lapses: the Zombie walks on', () => {
    const g = new Game();
    unwrap(g.animate(), 'the rite');
    const zombie = g.zombie();
    g.wait(DAY);
    expect(g.state.creatures[zombie]?.summonedBy).toBeNull();
    expect(walkerOf(g.state, SER)).toBe(zombie);
    expect(code(g.cast(CLERIC, 'revivify'))).toBe('body_walks');
    expect(code(g.cast(PRIEST, 'animate-dead'))).toBe('body_walks');
    expect(code(g.cast(PRIEST, 'gentle-repose'))).toBe('body_walks');
  });

  /**
   * The two spells whose target rule asks for a corpse ask it here, before a
   * slot is spent or a rite begins: the body is dead and is still not a corpse
   * anybody can reach, and a request for where it lies would send the caller
   * to place a body that is walking about.
   */
  it('refuses a second Animate Dead on her before the rite begins', () => {
    const g = new Game();
    unwrap(g.animate(), 'the rite');
    const refused = g.cast(PRIEST, 'animate-dead');
    expect(code(refused)).toBe('body_walks');
    expect(g.spent(PRIEST, 3)).toBe(0);
    expect(pendingCastingsOf(g.state)).toEqual([]);
  });

  it('refuses Gentle Repose on her before the slot is spent', () => {
    const g = new Game();
    unwrap(g.animate(), 'the rite');
    expect(code(g.cast(PRIEST, 'gentle-repose'))).toBe('body_walks');
    expect(g.spent(PRIEST, 2)).toBe(0);
  });

  it('leaves her off the shortlist of a spell cast on a corpse, saying why', () => {
    const g = new Game();
    unwrap(g.animate(), 'the rite');
    const offered = eligibleTargets(g.state, homebrew, PRIEST, 'gentle-repose', 2);
    expect(offered.eligible).not.toContain(SER);
    expect(offered.excluded.find((one) => one.target === SER)?.reason).toMatch(/walking about/);
  });
});

describe('a body Gentle Repose keeps', () => {
  /**
   * SRD Gentle Repose: "For the duration, the target is protected from decay
   * and can't become Undead." Asked before the rite begins, so the slot is
   * not spent on a body the book says cannot rise.
   */
  it('refuses Animate Dead before the rite begins', () => {
    const g = new Game();
    unwrap(g.cast(PRIEST, 'gentle-repose'), 'the repose');
    const refused = g.cast(CLERIC, 'animate-dead');
    expect(code(refused)).toBe('cannot_become_undead');
    expect(g.spent(CLERIC, 3)).toBe(0);
    expect(pendingCastingsOf(g.state)).toEqual([]);
  });
});

describe('the body lies where its walker fell', () => {
  const fallen = (): { g: Game; zombie: CharacterId; where: unknown } => {
    const g = new Game();
    unwrap(g.animate(), 'the rite');
    const zombie = g.zombie();
    const where = g.state.scene!.positions[zombie];
    // A round of the fight it was raised for, so the body is past Revivify's
    // minute by more than the rite's own.
    g.wait(6);
    g.push([{ type: 'damage-taken', id: zombie, amount: 40, source: 'a greataxe' }]);
    return { g, zombie, where };
  };

  it('puts Ser in the Zombie’s space and takes the Zombie off the map, still dead in the roster', () => {
    const { g, zombie, where } = fallen();
    expect(g.state.creatures[zombie]?.vitals.dead).toBe(true);
    expect(g.state.creatures[zombie]).toBeDefined();
    expect(g.state.scene!.positions[zombie]).toBeUndefined();
    expect(g.state.scene!.positions[SER]).toEqual(where);
    expect(g.state.scene!.sizes[SER]).toBe(g.state.creatures[SER]!.size);
    expect(walkerOf(g.state, SER)).toBeNull();
    expect(replayed(g.events)).toEqual(g.state);
  });

  it('refuses Revivify only for the minute, now that nothing walks', () => {
    const { g } = fallen();
    expect(code(g.cast(CLERIC, 'revivify'))).toBe('died_too_long_ago');
  });

  it('lets a ten-day homebrew revival bring her back at her own level, with her own sheet, pools and gear', () => {
    const { g } = fallen();
    const before = g.state.creatures[SER]!;
    unwrap(g.cast(CLERIC, 'homebrew-raising'), 'the raising');
    const after = g.state.creatures[SER]!;
    expect(after.vitals.dead).toBe(false);
    expect(after.vitals.hp).toBe(1);
    expect(after.character).toEqual(before.character);
    expect(after.character?.level).toBe(5);
    expect(after.sheet).toEqual(before.sheet);
    expect(after.resources).toEqual(before.resources);
    expect(after.inventory).toEqual(before.inventory);
    expect(after.coins).toBe(before.coins);
    expect(replayed(g.events)).toEqual(g.state);
  });

  it('only on the falling edge: a Zombie that was already dead and is placed again is left where it is put', () => {
    const { g, zombie } = fallen();
    const lying = g.state.scene!.positions[SER];
    g.push([{ type: 'creature-placed', id: zombie, placement: { from: { creature: CLERIC }, feet: 10, bearing: 180 } }]);
    expect(g.state.scene!.positions[zombie]).toBeDefined();
    expect(g.state.scene!.positions[SER]).toEqual(lying);
  });

  it('leaves her unplaced when the Zombie is taken out of the game instead', () => {
    const g = new Game();
    unwrap(g.animate(), 'the rite');
    const zombie = g.zombie();
    g.push(unwrap(removeCreatureEverywhere(g.state, zombie), 'the zombie leaves'));
    expect(g.state.creatures[zombie]).toBeUndefined();
    expect(g.state.creatures[SER]?.vitals.dead).toBe(true);
    expect(g.state.scene!.positions[SER]).toBeUndefined();
    expect(walkerOf(g.state, SER)).toBeNull();
    // Hers to place, and once she is, only the minute stands in the way.
    g.wait(6);
    g.push([{ type: 'creature-placed', id: SER, placement: { from: { creature: CLERIC }, feet: 5, bearing: 0 } }]);
    expect(code(g.cast(CLERIC, 'revivify'))).toBe('died_too_long_ago');
  });
});

/**
 * The backstops, driven where the pre-flight cannot see: a rite declared
 * before the fact that refuses it came to be, and settled after.
 */
describe('the resolvers refuse a body that is not a corpse', () => {
  it('refuses a second Zombie from one body', () => {
    const g = new Game();
    const first = g.declare(CLERIC, 'animate-dead');
    const second = g.declare(PRIEST, 'animate-dead');
    g.wait(60);
    unwrap(g.settle(first), 'the first rite');
    const refused = g.settle(second);
    expect(code(refused)).toBe('body_walks');
  });

  it('refuses to lay Gentle Repose on a body that rose while the ritual was being said', () => {
    const g = new Game();
    const repose = g.declare(PRIEST, 'gentle-repose', { ritual: true });
    const rite = g.declare(CLERIC, 'animate-dead');
    g.wait(60);
    unwrap(g.settle(rite), 'the rite');
    g.wait(600);
    expect(code(g.settle(repose))).toBe('body_walks');
  });

  /**
   * SRD Gentle Repose: "For the duration, the target is protected from decay
   * and can't become Undead." A rite already under way when the repose is laid
   * is refused when it completes.
   */
  it('refuses to raise a body a running Gentle Repose keeps', () => {
    const g = new Game();
    const rite = g.declare(CLERIC, 'animate-dead');
    unwrap(g.cast(PRIEST, 'gentle-repose'), 'the repose');
    g.wait(60);
    expect(code(g.settle(rite))).toBe('cannot_become_undead');
    expect(g.state.creatures[SER]?.vitals.dead).toBe(true);
    expect(walkerOf(g.state, SER)).toBeNull();
  });
});

describe('the fold holds the link to a body', () => {
  const raisedLog = (): { log: GameEvent[]; zombie: CharacterId } => {
    const g = new Game();
    unwrap(g.animate(), 'the rite');
    return { log: [...g.events], zombie: g.zombie() };
  };

  it('refuses a creature raised from a body the game does not hold', () => {
    const { log, zombie } = raisedLog();
    const rewritten = log.map((event) =>
      event.type === 'creature-summoned' && event.id === zombie ? { ...event, raisedFrom: id('nobody') } : event,
    );
    expect(() => fold('seed', rewritten)).toThrow(CorruptLogError);
  });

  it('refuses a second living walker for one body', () => {
    const { log } = raisedLog();
    expect(() =>
      fold('seed', [
        ...log,
        { type: 'creature-added', id: id('ghoul'), name: 'ghoul', sheet: sheet(), maxHp: 20, diesAtZero: true, creatureType: 'Undead' },
        { type: 'creature-summoned', id: id('ghoul'), by: CLERIC, controlled: { spell: 'animate-dead', until: DAY }, raisedFrom: SER },
      ]),
    ).toThrow(/already walks/);
  });
});
