import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { Weapon } from '@ie/srd';
import { armorClass } from './character.js';
import { rollAttack, rollAttackDamage, applyDamage } from './attack.js';
import { ROUND } from './clock.js';
import { rollInitiative, spendAction, spendBonusAction, spendReaction } from './combat.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { createRollIssuer, type RollIssuer } from './rolls.js';
import { pendingSavesOf, resolveDamage, resolveSpell, resolveTurn } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { levelGrantedSpells, type SpellbookEntry } from './spellbook.js';
import { FIRE_BOLT, scaledDiceFor } from './spell-definitions.js';

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

/**
 * **Where the engine stops and this fixture starts.**
 *
 * Smaller than it was. Fire Bolt and Hold Person now have executable
 * definitions in `spell-definitions.ts`, so the engine derives their attack
 * modifier, save DC, damage dice, scaling, duration, condition and end-of-turn
 * repeat save from the definition and the caster's own sheet. This file names
 * a spell and some targets; it no longer says what either spell does.
 *
 * | Engine-owned, called through its own operations | Fixture-supplied |
 * |---|---|
 * | The whole of a casting: access, targets, range, cover, slot, action, damage, saves, conditions, Concentration (`resolveSpell`) | Which spell is cast, at whom, with which slot |
 * | Turn-boundary saves: raising them, rolling them, applying the outcome (`resolveTurn`) | Who attacks whom with what weapon |
 * | Attack resolution, criticals, typed damage, defences | The scripted order of a fight |
 * | Damage, and the Concentration save it forces (`resolveDamage`) | |
 * | Losing Concentration, and cleaning up what that casting did | |
 * | Turn economy, the clock, Initiative order | |
 * | Character creation: proficiencies, feats, spells, pools | |
 *
 * A spell with no definition cannot be cast through `resolveSpell` at all, and
 * says so — so this fixture cannot quietly reintroduce its own version of one.
 */

const id = (s: string) => asCharacterId(s);

const WIZARD = id('kessa');
const GOBLIN_A = id('goblin-a');
const GOBLIN_B = id('goblin-b');
/** A Humanoid, because Hold Person may only touch one. */
const BANDIT = id('bandit');

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
  // SRD 2024: "Small Fey (Goblinoid)". Goblins stopped being Humanoid, which
  // is exactly why Hold Person cannot touch one.
  creatureType: 'Fey',
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

/**
 * There is no FIRE_BOLT or HOLD_PERSON here any more, and that is the point.
 *
 * Both used to be transcribed into this file: damage dice, save ability,
 * condition, duration, and the rule that the save repeats. A level 3 Wizard
 * threw Fire Bolt for 2d10 for exactly as long as nobody checked. They are
 * engine definitions now, and this fixture cannot state a spell's mechanics
 * even by accident.
 */

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
  if (round === 1) {
    // The wizard reaches for Hold Person and the engine says no: goblins are
    // Fey. The script falls through to a cantrip, as a player would.
    if (!holdPersonWouldBeRefused(t, GOBLIN_A)) {
      throw new Error('a goblin should not be a legal Hold Person target');
    }
  }

  // A Fire Bolt at whichever goblin is still up, resolved by the engine.
  void round;
  const target = aliveAt(t, GOBLIN_A) ? GOBLIN_A : aliveAt(t, GOBLIN_B) ? GOBLIN_B : null;
  if (target === null) return;

  const { issuer, rng } = t.supply();
  const outcome = resolveSpell(
    t.state(),
    WIZARD,
    { spellId: 'fire-bolt', targets: [target] },
    { issuer, rng },
  );
  if (outcome.ok && outcome.value.kind === 'resolved') t.push(...outcome.value.events);
}

/**
 * Cast Hold Person at a target. Everything else is the engine's.
 *
 * The DC, the target's save, the Paralyzed condition, the one-minute duration
 * and the end-of-turn repeat save all come from the definition and the
 * caster's sheet. This says which spell and which target.
 */
function castHoldPerson(
  t: Table,
  target: CharacterId,
  bonuses: readonly { source: string; flat: number }[] = [],
): boolean {
  const { issuer, rng } = t.supply();
  const outcome = unwrap(
    resolveSpell(
      t.state(),
      WIZARD,
      { spellId: 'hold-person', targets: [target], slotLevel: 2 },
      { issuer, rng, bonuses },
    ),
    'hold person',
  );
  if (outcome.kind !== 'resolved') {
    throw new Error(`the cast wanted context: ${JSON.stringify(outcome.requests)}`);
  }
  t.push(...outcome.events);
  return outcome.outcomes.some((o) => o.affected);
}

/**
 * Whether Hold Person may legally be aimed at this creature at all.
 *
 * SRD 2024 makes a Goblin Warrior **Fey**, and Hold Person says "Choose a
 * Humanoid". The scripted fight has been casting it at goblins since the day
 * it was written, and nothing could say so until the engine carried a creature
 * type. It says so now.
 */
function holdPersonWouldBeRefused(t: Table, target: CharacterId): boolean {
  const { issuer, rng } = t.supply();
  const attempt = resolveSpell(
    t.state(),
    WIZARD,
    { spellId: 'hold-person', targets: [target], slotLevel: 2 },
    { issuer, rng },
  );
  return !attempt.ok && attempt.code === 'wrong_creature_type';
}

/**
 * There is no `repeatHoldPersonSave` here any more, and that is the point.
 *
 * The repeat save used to be driven by this fixture: roll it at the right
 * moment, and remember to. Now the hook rides on the effect, turn advancement
 * raises the save, and `resolveTurn` rolls it. A fixture that forgot would not
 * quietly skip the rule — the engine refuses to advance the next turn while a
 * boundary save is outstanding.
 */
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

      // Ending the turn is an engine operation: it raises whatever the
      // boundary owes and rolls it. Nothing here asks for a repeat save.
      const { issuer, rng } = t.supply();
      t.push(...unwrap(resolveTurn(t.state(), { issuer, rng }), 'turn').events);
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

  /**
   * The wizard reaches for Hold Person in round 1, the engine refuses — goblins
   * are Fey — and they throw cantrips for four rounds instead. So no slot is
   * spent at all, which is exactly the shape a refusal should leave behind.
   */
  it('spent no slot, because the only levelled spell was refused', () => {
    const resources = finished().creatures[WIZARD]!.resources;
    expect(remaining(resources, spellSlotKey(2))).toBe(2);
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
   * The refusal is the point. SRD 2024 makes a Goblin Warrior Fey and Hold
   * Person wants a Humanoid, so the spell the script reaches for first is not
   * legal — and was cast anyway until the engine carried a creature type.
   *
   * The Concentration seam this scenario used to cover moved to the controlled
   * variant below, which has a Humanoid to hold.
   */
  it('refused Hold Person on a Fey goblin', () => {
    const t = table(SEED);
    t.push(...unwrap(createCharacter(KESSA, WIZARD), 'create'));
    t.push(goblin(GOBLIN_A));
    t.push(
      { type: 'scene-set', extent: { width: 60, depth: 40, height: 20 } },
      { type: 'landmark-added', name: 'the bar', at: { x: 10, y: 10, z: 0 } },
      { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the bar' }, feet: 0 } },
      { type: 'creature-placed', id: GOBLIN_A, placement: { from: { creature: WIZARD }, feet: 15, bearing: 0 } },
      { type: 'sight-declared', from: WIZARD, to: GOBLIN_A, seen: true },
    );
    expect(holdPersonWouldBeRefused(t, GOBLIN_A)).toBe(true);
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

  /**
   * What this particular seed produces, recorded because a golden scenario
   * that asserts only invariants would pass even if the fight stopped
   * happening. Correcting Fire Bolt from 2d10 to the 1d10 a level 3 Wizard
   * actually throws turned a walkover into this: the goblins survive, the
   * wizard fails a Concentration save on a natural 1, and then goes down.
   */
  it('tells the story the log records', () => {
    const log = playScenario(SEED);
    const said = log
      .filter((e) => e.type === 'roll-recorded')
      .map((e) => (e.type === 'roll-recorded' ? `${e.label}:${e.outcome ?? ''}` : ''));

    // Four rounds of cantrips and scimitars, and nothing else: Hold Person
    // never went off, so no save and no Concentration appear anywhere.
    expect(said.filter((s) => s.startsWith('Fire Bolt attack'))).toHaveLength(4);
    expect(said.some((s) => s.includes('Hold Person'))).toBe(false);

    const state = fold(SEED, log);
    expect(state.creatures[WIZARD]!.concentration).toBeNull();

    // The wizard survived on four hit points; both goblins did not.
    expect(state.creatures[WIZARD]!.vitals.hp).toBe(4);
    expect(state.creatures[GOBLIN_A]!.vitals.dead).toBe(true);
    expect(state.creatures[GOBLIN_B]!.vitals.dead).toBe(true);
  });
});

/**
 * A controlled variant, to walk a branch the seeded fight does not reach.
 *
 * The main scenario is a fight: the dice fall where they fall, and in that one
 * the goblin happens to resist. This variant forces the outcomes instead, with
 * flat modifiers big enough that no die can change them, because the branch
 * being checked is *Hold Person lands, then Concentration is lost* — and that
 * is worth checking on purpose rather than waiting for a seed that produces it.
 *
 * Initiative is stated rather than rolled for the same reason: the sequence of
 * turns is the thing under test, so it should not vary.
 */
const CERTAIN = [{ source: 'the variant insists', flat: 40 }];
const DOOMED = [{ source: 'the variant insists', flat: -40 }];

const controlled = () => {
  const t = table('hold-person-variant');
  t.push(...unwrap(createCharacter(KESSA, WIZARD), 'create'));
  // A bandit stands in for the goblins here: Hold Person needs a Humanoid, and
  // SRD 2024 goblins are Fey. The main fight proves that refusal; this variant
  // is about what happens once the spell actually lands.
  const bandit: GameEvent = {
    ...(goblin(BANDIT) as Extract<GameEvent, { type: 'creature-added' }>),
    name: 'Bandit',
    creatureType: 'Humanoid',
  };
  t.push(bandit, goblin(GOBLIN_B));
  t.push(
    { type: 'scene-set', extent: { width: 60, depth: 40, height: 20 } },
    { type: 'landmark-added', name: 'the bar', at: { x: 10, y: 10, z: 0 } },
    { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the bar' }, feet: 0 } },
    { type: 'creature-placed', id: BANDIT, placement: { from: { creature: WIZARD }, feet: 15, bearing: 0 } },
    { type: 'creature-placed', id: GOBLIN_B, placement: { from: { creature: WIZARD }, feet: 15, bearing: 90 } },
    { type: 'sight-declared', from: WIZARD, to: BANDIT, seen: true },
    { type: 'sight-declared', from: WIZARD, to: GOBLIN_B, seen: true },
  );
  t.push({
    type: 'combat-started',
    combatants: [
      { id: WIZARD, initiative: 20, speed: 30 },
      { id: BANDIT, initiative: 10, speed: 30 },
      { id: GOBLIN_B, initiative: 5, speed: 30 },
    ],
  });
  return t;
};

/**
 * End the current turn through the engine, forcing any boundary save it raises.
 *
 * The variant never asks for a repeat save. It ends turns, and the engine
 * works out what that costs.
 */
const endTurn = (
  t: Table,
  bonuses: readonly { source: string; flat: number }[],
): ReturnType<typeof resolveTurn> => {
  const { issuer, rng } = t.supply();
  const outcome = resolveTurn(t.state(), { issuer, rng, bonuses });
  if (outcome.ok) t.push(...outcome.value.events);
  return outcome;
};

/** Everything a Paralyzed creature may not do, asked of the engine. */
const cannotAct = (t: Table, who: CharacterId) => {
  const combat = t.state().combat!;
  const conditions = conditionsOf(t, who);
  return {
    action: spendAction(combat, who, conditions),
    bonusAction: spendBonusAction(combat, who, conditions),
    reaction: spendReaction(combat, who, conditions),
  };
};

describe('Hold Person lands, holds, and lets go when Concentration breaks', () => {
  it('paralyses a target that fails its save, linked to the casting', () => {
    const t = controlled();
    expect(castHoldPerson(t, BANDIT, DOOMED)).toBe(true);

    const held = conditionsOf(t, BANDIT);
    expect(held.conditions).toContain('paralyzed');
    // SRD Paralyzed: "You have the Incapacitated condition."
    expect(held.conditions).toContain('incapacitated');
    expect(t.state().creatures[WIZARD]!.concentration).toMatchObject({ spell: 'Hold Person' });
  });

  /** SRD Incapacitated: "You can't take any action, Bonus Action, or Reaction." */
  it('stops the paralysed creature taking an action, Bonus Action or Reaction', () => {
    const t = controlled();
    castHoldPerson(t, BANDIT, DOOMED);
    endTurn(t, DOOMED); // the goblin's turn comes round

    const refused = cannotAct(t, BANDIT);
    expect(refused.action.ok).toBe(false);
    expect(refused.bonusAction.ok).toBe(false);
    expect(refused.reaction.ok).toBe(false);
    for (const outcome of Object.values(refused)) {
      if (!outcome.ok) expect(outcome.code).toBe('incapacitated');
    }
  });

  /** And the other goblin, untouched, can act perfectly well. */
  it('leaves the creature it did not hold alone', () => {
    const t = controlled();
    castHoldPerson(t, BANDIT, DOOMED);
    endTurn(t, DOOMED);
    endTurn(t, DOOMED);
    expect(cannotAct(t, GOBLIN_B).action.ok).toBe(true);
  });

  /**
   * "At the end of each of its turns, the target repeats the save, ending the
   * spell on itself on a success."
   */
  it('keeps holding when the end-of-turn save fails', () => {
    const t = controlled();
    castHoldPerson(t, BANDIT, DOOMED);
    endTurn(t, DOOMED); // the wizard's turn ends; nothing is owed

    const goblinsTurn = endTurn(t, DOOMED);
    expect(goblinsTurn.ok && goblinsTurn.value.saves).toMatchObject([{ success: false }]);
    expect(conditionsOf(t, BANDIT).conditions).toContain('paralyzed');
    expect(t.state().creatures[WIZARD]!.concentration).not.toBeNull();
  });

  it('frees the target when the end-of-turn save succeeds, without ending the spell', () => {
    const t = controlled();
    castHoldPerson(t, BANDIT, DOOMED);
    endTurn(t, DOOMED);

    const goblinsTurn = endTurn(t, CERTAIN);
    expect(goblinsTurn.ok && goblinsTurn.value.saves).toMatchObject([{ success: true }]);
    expect(conditionsOf(t, BANDIT).conditions).not.toContain('paralyzed');
    expect(conditionsOf(t, BANDIT).conditions).not.toContain('incapacitated');
    // The caster is still concentrating: the spell ended on the target, not on them.
    expect(t.state().creatures[WIZARD]!.concentration).toMatchObject({ spell: 'Hold Person' });
    // And the goblin can act again on its next turn: the save ended its own
    // turn, so two more boundaries (goblin-b, then the wizard) bring it round.
    endTurn(t, DOOMED);
    endTurn(t, DOOMED);
    expect(t.state().combat!.order[t.state().combat!.turnIndex]!.id).toBe(BANDIT);
    expect(cannotAct(t, BANDIT).action.ok).toBe(true);
  });

  /** Nothing in the variant asks for the save; ending a turn is what raises it. */
  it('raises the save without anybody requesting it', () => {
    const t = controlled();
    castHoldPerson(t, BANDIT, DOOMED);
    expect(endTurn(t, DOOMED).ok && true).toBe(true);

    const owed = pendingSavesOf(fold('hold-person-variant', t.log()));
    expect(owed).toEqual([]);

    const goblinsTurn = endTurn(t, DOOMED);
    expect(goblinsTurn.ok && goblinsTurn.value.saves.map((s) => s.label)).toEqual([
      'Wisdom save vs Hold Person',
    ]);
  });

  /**
   * The branch this variant exists for. The wizard is holding a goblin, the
   * *other* goblin hits them, and `resolveDamage` — unprompted — works out a
   * Concentration save is owed, rolls it, fails it, ends the casting, and the
   * paralysis it caused goes with it. Nothing in this test asks for any of
   * that beyond supplying a modifier that makes the save fail.
   */
  it('drops the paralysis when a failed Concentration save ends the spell', () => {
    const t = controlled();
    castHoldPerson(t, BANDIT, DOOMED);
    expect(conditionsOf(t, BANDIT).conditions).toContain('paralyzed');

    const { issuer, rng } = t.supply();
    const outcome = unwrap(
      resolveDamage(
        t.state(),
        WIZARD,
        { amount: 7, source: 'Scimitar' },
        { issuer, rng, bonuses: DOOMED },
      ),
      'damage',
    );
    t.push(...outcome.events);

    expect(outcome.concentration).toMatchObject({ kind: 'resolved', maintained: false });
    expect(t.state().creatures[WIZARD]!.concentration).toBeNull();
    expect(conditionsOf(t, BANDIT).conditions).not.toContain('paralyzed');
    expect(conditionsOf(t, BANDIT).conditions).not.toContain('incapacitated');

    // Freed, the bandit can act on its turn again.
    endTurn(t, DOOMED);
    expect(cannotAct(t, BANDIT).action.ok).toBe(true);
  });

  it('keeps holding when the Concentration save is made', () => {
    const t = controlled();
    castHoldPerson(t, BANDIT, DOOMED);

    const { issuer, rng } = t.supply();
    const outcome = unwrap(
      resolveDamage(
        t.state(),
        WIZARD,
        { amount: 7, source: 'Scimitar' },
        { issuer, rng, bonuses: CERTAIN },
      ),
      'damage',
    );
    t.push(...outcome.events);

    expect(outcome.concentration).toMatchObject({ kind: 'resolved', maintained: true });
    expect(conditionsOf(t, BANDIT).conditions).toContain('paralyzed');
  });

  it('replays byte-identically, like the fight does', () => {
    const play = () => {
      const t = controlled();
      castHoldPerson(t, BANDIT, DOOMED);
      endTurn(t, DOOMED);
      endTurn(t, DOOMED);
      return t.log();
    };
    expect(JSON.stringify(play())).toBe(JSON.stringify(play()));
  });
});

describe('Fire Bolt scales the way the SRD says', () => {
  /**
   * The mistake that started this. A level 3 Wizard's Fire Bolt is 1d10; 2d10
   * is the level 5 damage. It lived in this file's own fixture, where nothing
   * could check it. The rule is in `spell-definitions.ts` now, with its own
   * tests — this one only asserts that the scenario's caster is the level the
   * correction was about.
   */
  it('is cast by a level 3 Wizard, which is one die', () => {
    expect(KESSA.level).toBe(3);
    const bolt = FIRE_BOLT.effects[0];
    if (bolt?.kind !== 'attack') throw new Error('Fire Bolt is an attack spell');
    expect(scaledDiceFor(bolt.damage, 0, KESSA.level, 0)).toBe('1d10');
  });
});

