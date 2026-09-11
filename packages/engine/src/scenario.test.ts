import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { Weapon } from '@ie/srd';
import { armorClass } from './character.js';
import { rollSavingThrow } from './checks.js';
import { rollAttack, rollAttackDamage, applyDamage } from './attack.js';
import { ROUND } from './clock.js';
import { rollInitiative } from './combat.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { createRollIssuer, type RollIssuer } from './rolls.js';
import { spellSaveDc } from './character.js';
import {
  applySpellEffect,
  recordD20Test,
  resolveCast,
  resolveDamage,
} from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { levelGrantedSpells, type SpellbookEntry } from './spellbook.js';

/**
 * The milestone's own ship criterion: **a scripted combat between two parties
 * resolves identically from the same seed.**
 *
 * Every other test in this package exercises one module or one seam. This one
 * plays a fight through the public API the way a caller would — create a
 * character from choices, roll Initiative, cast, attack, take damage, save
 * against losing Concentration, drop a creature, rest, level up — and asserts
 * that the whole thing is reproducible.
 *
 * What that actually proves, and why each assertion is here:
 *
 * - Replaying the log gives the same state. That is the reducer's promise.
 * - Replaying the *script* from the same seed gives the same log. That is the
 *   stronger promise, and the only one that catches a module reading a clock,
 *   iterating a map in insertion order, or otherwise smuggling in a decision
 *   nothing recorded.
 * - A different seed gives a different log, so the first assertion is not
 *   passing because nothing is random.
 */

const id = (s: string) => asCharacterId(s);

const WIZARD = id('kessa');
const GOBLIN_A = id('goblin-a');
const GOBLIN_B = id('goblin-b');

/** SRD Goblin Warrior: AC 15, HP 10, Initiative +2, Scimitar +4 (1d6+2). */
const GOBLIN_AC = 15;
const GOBLIN_HP = 10;

const SCIMITAR: Weapon = {
  id: 'scimitar',
  name: 'Scimitar',
  category: 'martial',
  kind: 'melee',
  damage: { dice: '1d6', fixed: null, type: 'slashing' },
  properties: ['finesse', 'light'],
  versatileDamage: null,
  thrownRange: null,
  ammunitionRange: null,
  ammunitionType: null,
  propertyNotes: null,
  mastery: 'nick',
  weightLb: 3,
  cost: { amount: 25, currency: 'gp' },
};

/**
 * A Goblin Warrior as `adaptMonster` produces one: printed numbers in
 * `stated`, so nothing is reverse-engineered from proficiencies that happen to
 * add up.
 */
const goblin = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: 'Goblin Warrior',
  maxHp: GOBLIN_HP,
  diesAtZero: true,
  sheet: {
    level: 1,
    abilities: { str: 8, dex: 15, con: 10, int: 10, wis: 8, cha: 8 },
    skills: {},
    saveProficiencies: [],
    armor: null,
    shield: null,
    armorTraining: { light: true, medium: true, heavy: false, shields: true },
    baseSpeed: 30,
    spellcastingAbility: null,
    stated: { armorClass: GOBLIN_AC, proficiencyBonus: 2, initiative: 2 },
  },
});

const book = (level: number): SpellbookEntry[] =>
  [
    'magic-missile',
    'shield',
    'detect-magic',
    'feather-fall',
    'mage-armor',
    'sleep',
    'thunderwave',
    'hold-person',
    'misty-step',
    'web',
  ]
    .slice(0, levelGrantedSpells(level))
    .map((spellId, index) => ({
      spellId,
      acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
      origin: 'level' as const,
    }));

const KESSA: CharacterChoices = {
  name: 'Kessa',
  classId: 'wizard',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Chaotic Good',
  subclassId: 'evoker',
  cantrips: ['fire-bolt', 'light', 'prestidigitation'],
  spellbook: book(3),
  preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'hold-person', 'burning-hands', 'scorching-ray'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'wizard:scholar': ['arcana'],
    'human:skillful': ['perception'],
    'evoker:evocation-savant': ['burning-hands', 'scorching-ray'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'survival'] },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
};

/**
 * The table: a log, and the machinery to add to it.
 *
 * The generator is rebuilt from state before every roll and its final position
 * written back as a `rolls-issued` event, which is exactly what a resumed
 * session does. If that bookkeeping were wrong the scripted replay would
 * diverge, which is the point of running it twice.
 */
const table = (seed: string) => {
  let log: GameEvent[] = [];

  const state = (): GameState => fold(seed, log);
  const push = (...events: readonly GameEvent[]): void => {
    log = [...log, ...events];
  };
  const run = (command: (s: GameState) => Result<GameEvent[]>): void => {
    push(...unwrap(command(state()), 'command'));
  };
  const supply = () => {
    const now = state();
    return {
      issuer: createRollIssuer('r', now.rollsIssued),
      rng: now.rng === null ? createRng(seed) : restoreRng(now.rng),
    };
  };
  /** Roll something, then record where the generator got to. */
  const rolling = <T>(fn: (issuer: RollIssuer, rng: Rng) => Result<T>): T => {
    const { issuer, rng } = supply();
    const before = issuer.count;
    const outcome = unwrap(fn(issuer, rng), 'roll');
    push({ type: 'rolls-issued', count: issuer.count - before, rng: rng.snapshot() });
    return outcome;
  };

  return { state, push, run, supply, rolling, log: () => log };
};

type Table = ReturnType<typeof table>;

const sheetOf = (t: Table, who: CharacterId) => t.state().creatures[who]!.sheet;
const conditionsOf = (t: Table, who: CharacterId) => t.state().creatures[who]!.conditions;
const aliveAt = (t: Table, who: CharacterId): boolean => {
  const creature = t.state().creatures[who];
  return creature !== undefined && !creature.vitals.dead && creature.vitals.hp > 0;
};

/** One goblin swings a scimitar at the wizard. */
function goblinAttacks(t: Table, who: CharacterId): void {
  t.push({ type: 'action-spent', id: who });

  const attack = t.rolling((issuer, rng) =>
    rollAttack(issuer, rng, sheetOf(t, who), {
      weapon: SCIMITAR,
      targetAc: armorClass(sheetOf(t, WIZARD)),
      attackerConditions: conditionsOf(t, who),
      targetConditions: conditionsOf(t, WIZARD),
    }),
  );
  t.push({
    type: 'roll-recorded',
    who,
    label: 'Scimitar attack',
    natural: attack.roll.natural,
    total: attack.total,
    contributions: [{ source: 'attack modifier', amount: attack.total - attack.roll.natural }],
    outcome: attack.hit ? 'hit' : 'miss',
  });
  if (!attack.hit) return;

  const damage = t.rolling((issuer, rng) =>
    rollAttackDamage(
      issuer,
      rng,
      sheetOf(t, who),
      { weapon: SCIMITAR, targetAc: GOBLIN_AC },
      attack.critical,
    ),
  );
  const applied = applyDamage(damage.components, {});

  // `resolveDamage` settles the Concentration save itself, which is the whole
  // reason it exists: a caller cannot forget the second half.
  const { issuer, rng } = t.supply();
  const outcome = unwrap(
    resolveDamage(
      t.state(),
      WIZARD,
      { amount: applied.total, source: 'Scimitar', ...(attack.critical ? { critical: true } : {}) },
      { issuer, rng },
    ),
    'damage',
  );
  t.push(...outcome.events);
}

/** The wizard's turn, which changes with what is still standing. */
function wizardActs(t: Table, round: number): void {
  const holding = t.state().creatures[WIZARD]!.concentration !== null;

  if (round === 1) {
    t.run((s) =>
      resolveCast(s, WIZARD, {
        spell: 'Hold Person',
        level: 2,
        concentration: true,
        slotLevel: 2,
        duration: { kind: 'seconds', seconds: 60 },
      }),
    );

    // The goblin resists with a Wisdom save against the wizard's spell DC.
    const dc = spellSaveDc(sheetOf(t, WIZARD)) ?? 13;
    const save = t.rolling((issuer, rng) =>
      rollSavingThrow(issuer, rng, sheetOf(t, GOBLIN_A), 'wis', {
        dc,
        conditions: conditionsOf(t, GOBLIN_A),
      }),
    );
    t.push(recordD20Test(GOBLIN_A, 'Wisdom save vs Hold Person', save, save.success ? 'resisted' : 'held'));
    if (!save.success) {
      t.run((s) => applySpellEffect(s, GOBLIN_A, 'paralyzed', WIZARD));
    }
    return;
  }

  // A Fire Bolt at whichever goblin is still up, or nothing if the fight is won.
  const target = aliveAt(t, GOBLIN_A) ? GOBLIN_A : aliveAt(t, GOBLIN_B) ? GOBLIN_B : null;
  if (target === null) return;

  t.run((s) => resolveCast(s, WIZARD, { spell: 'Fire Bolt', level: 0, slotless: 'cantrip' }));

  const attack = t.rolling((issuer, rng) =>
    rollAttack(issuer, rng, sheetOf(t, WIZARD), {
      weapon: null,
      targetAc: GOBLIN_AC,
      attackBonuses: [{ source: 'Fire Bolt (spell attack)', flat: 5 }],
      targetConditions: conditionsOf(t, target),
    }),
  );
  t.push({
    type: 'roll-recorded',
    who: WIZARD,
    label: 'Fire Bolt',
    natural: attack.roll.natural,
    total: attack.total,
    contributions: [{ source: 'spell attack', amount: 5 }],
    outcome: attack.hit ? 'hit' : 'miss',
  });
  if (!attack.hit) return;

  const burn = t.rolling((issuer, rng) =>
    rollAttackDamage(
      issuer,
      rng,
      sheetOf(t, WIZARD),
      {
        weapon: null,
        targetAc: GOBLIN_AC,
        extraDamage: [{ source: 'Fire Bolt', type: 'fire', dice: '2d10' }],
      },
      attack.critical,
    ),
  );
  const applied = applyDamage(
    burn.components.filter((c) => c.source === 'Fire Bolt'),
    {},
  );
  const { issuer, rng } = t.supply();
  t.push(
    ...unwrap(
      resolveDamage(t.state(), target, { amount: applied.total, source: 'Fire Bolt' }, { issuer, rng }),
      'fire bolt damage',
    ).events,
  );
  void holding;
}

/** Play the whole fight. Deterministic given the seed, branches and all. */
function playScenario(seed: string): GameEvent[] {
  const t = table(seed);

  // — the cast ————————————————————————————————————————————————————————————
  t.push(...unwrap(createCharacter(KESSA, WIZARD), 'create'));
  t.push(goblin(GOBLIN_A), goblin(GOBLIN_B));

  // — the ground —————————————————————————————————————————————————————————
  t.push(
    { type: 'scene-set', extent: { width: 60, depth: 40, height: 20 } },
    { type: 'landmark-added', name: 'the bar', at: { x: 10, y: 10, z: 0 } },
    { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the bar' }, feet: 0 } },
    {
      type: 'creature-placed',
      id: GOBLIN_A,
      placement: { from: { creature: WIZARD }, feet: 15, bearing: 0 },
    },
    {
      type: 'creature-placed',
      id: GOBLIN_B,
      placement: { from: { creature: WIZARD }, feet: 15, bearing: 90 },
    },
  );

  // — Initiative ——————————————————————————————————————————————————————————
  const order = [WIZARD, GOBLIN_A, GOBLIN_B].map((who) => {
    const roll = t.rolling((issuer, rng) =>
      rollInitiative(issuer, rng, who, sheetOf(t, who), { conditions: conditionsOf(t, who) }),
    );
    return { id: who, initiative: roll.total, speed: 30 };
  });
  t.push({ type: 'combat-started', combatants: order });

  // — four rounds ————————————————————————————————————————————————————————
  for (let round = 1; round <= 4; round += 1) {
    for (const combatant of t.state().combat!.order) {
      const who = combatant.id;

      if (aliveAt(t, who)) {
        if (who === WIZARD) {
          wizardActs(t, round);
        } else if (!conditionsOf(t, who).conditions.includes('incapacitated')) {
          // A paralysed goblin takes no turn, which the turn economy enforces
          // anyway — this just keeps the script from asking.
          goblinAttacks(t, who);
        }
      }

      t.push({ type: 'turn-advanced' });
    }
  }

  return t.log();
}

describe('a scripted fight resolves identically from the same seed', () => {
  const SEED = 'tavern-brawl';

  /** The milestone's ship criterion, stated as plainly as it can be. */
  it('produces a byte-identical log when replayed from the same seed', () => {
    expect(JSON.stringify(playScenario(SEED))).toBe(JSON.stringify(playScenario(SEED)));
  });

  it('folds that log to a byte-identical state', () => {
    const log = playScenario(SEED);
    expect(JSON.stringify(fold(SEED, log))).toBe(JSON.stringify(fold(SEED, log)));
  });

  /** So the first assertion is not passing because nothing is random. */
  it('produces a different fight from a different seed', () => {
    expect(JSON.stringify(playScenario(SEED))).not.toBe(JSON.stringify(playScenario('other-seed')));
  });

  /**
   * The seed is recorded so a *live* session can carry on rolling. A replay
   * reads the numbers already written down, so it does not need the seed at
   * all — and folding the same log under a different one must not change a
   * thing.
   */
  it('replays the same log under a different seed to the same state', () => {
    const log = playScenario(SEED);
    const under = (seed: string) => ({ ...fold(seed, log), seed: '' });
    expect(JSON.stringify(under(SEED))).toBe(JSON.stringify(under('a completely different seed')));
  });

  it('replays prefix by prefix without diverging', () => {
    const log = playScenario(SEED);
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold(SEED, log.slice(0, n))).toEqual(fold(SEED, log.slice(0, n)));
    }
  });

  it('survives a round trip through JSON', () => {
    const log = playScenario(SEED);
    const revived = JSON.parse(JSON.stringify(log)) as GameEvent[];
    expect(fold(SEED, revived)).toEqual(fold(SEED, log));
  });
});

describe('what the scripted fight actually did', () => {
  const SEED = 'tavern-brawl';
  const finished = () => fold(SEED, playScenario(SEED));

  /** SRD: "A round represents about 6 seconds." Four rounds, one turn each. */
  it('advanced the clock four rounds', () => {
    const state = finished();
    expect(state.combat?.round).toBe(5);
    expect(state.elapsed).toBe(4 * ROUND);
  });

  it('kept every creature coherent', () => {
    const state = finished();
    for (const creature of Object.values(state.creatures)) {
      expect(creature.vitals.hp).toBeGreaterThanOrEqual(0);
      expect(creature.vitals.hp).toBeLessThanOrEqual(creature.vitals.hpMax);
      expect(Number.isFinite(creature.vitals.hp)).toBe(true);
    }
  });

  it('spent the level 2 slot on Hold Person and no other', () => {
    const state = finished();
    const resources = state.creatures[WIZARD]!.resources;
    expect(remaining(resources, spellSlotKey(2))).toBe(1);
    // Fire Bolt is a cantrip, so the level 1 slots are untouched.
    expect(remaining(resources, spellSlotKey(1))).toBe(4);
  });

  it('rolled dice, and wrote down where the generator got to', () => {
    const state = finished();
    expect(state.rollsIssued).toBeGreaterThan(8);
    expect(state.rng).not.toBeNull();
  });

  it('recorded every roll it made, so the log can explain the fight', () => {
    const log = playScenario(SEED);
    const recorded = log.filter((e) => e.type === 'roll-recorded');
    expect(recorded.length).toBeGreaterThan(4);
    for (const entry of recorded) {
      if (entry.type !== 'roll-recorded') continue;
      expect(entry.natural).toBeGreaterThanOrEqual(1);
      expect(entry.natural).toBeLessThanOrEqual(20);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  /**
   * The seam this scenario exists to cover. Nothing in the script asks for a
   * Concentration save: the wizard casts, a goblin hits them, and
   * `resolveDamage` works out that a save is owed, rolls it, and ends the
   * spell if it fails. If that stopped happening every other assertion here
   * would still pass, so it is pinned explicitly.
   */
  it('rolled a Concentration save nobody asked for, because damage landed', () => {
    const labels = playScenario(SEED)
      .filter((e) => e.type === 'roll-recorded')
      .map((e) => (e.type === 'roll-recorded' ? e.label : ''));

    expect(labels).toContain('Constitution save to maintain Hold Person');
    // And the spell it protected was actually cast, by the spell machinery.
    expect(labels).toContain('Wisdom save vs Hold Person');
  });

  /**
   * Concentration is the seam most likely to come apart across modules: a
   * casting starts it, damage tests it, a failed save or Incapacitation ends
   * it, and the paralysis it caused has to go with it. Whatever happened, the
   * two must agree.
   */
  it('keeps Concentration and the effect it caused in step', () => {
    const state = finished();
    const holding = state.creatures[WIZARD]!.concentration;
    const paralysed = state.creatures[GOBLIN_A]?.conditions.instances.some(
      (i) => i.condition === 'paralyzed',
    );
    if (holding === null) expect(paralysed ?? false).toBe(false);
  });
});

