import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer, type RollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createCharacter, planCharacter, type CharacterChoices } from './creation.js';
import { remaining } from './resources.js';
import {
  declineDamageReaction,
  resolveAttack,
  resolveDamage,
  resolveTurn,
  reactionOpportunities,
  removeCreatureEverywhere,
  resolveAttackDamage,
  resolveSpell,
  resolveTest,
  settleDamage,
  settleTest,
  takeDamageReaction,
  takeDamageResponse,
  takeTestReaction,
  type AttackResolution,
} from './commands.js';
import { offersForDamage } from './reactions.js';
import { armorClassOf } from './standing.js';
import type { DamageComponent } from './attack.js';
import type { PendingDamage } from './events.js';
import { spellsForClass } from '@ie/srd';
import { rowAt, slotsAt } from './progression.js';
import { allClasses } from './creation.js';

/**
 * A Reaction a class feature takes in answer to something.
 *
 * Eight features across five classes spent eleven batches saying *"needs an
 * interrupt the engine does not have"*, while the three pieces of arithmetic
 * they wanted — `reduceDamage`, `interveneAfterRoll`, `rerollTest` — sat
 * written, correct and reachable from no command at all.
 *
 * What was actually missing was not arithmetic and not a trigger language. It
 * was **two instants**: a damage roll that has been made and not applied, and a
 * D20 Test whose total is known and whose effects have not occurred. The SRD
 * names both, and Dark One's Own Luck names the second one in a single clause
 * — "after seeing the roll but before any of the roll's effects occur".
 *
 * So this file is about timing before it is about features. Its shape:
 *
 * | Window | Held open? | Proved by |
 * |---|---|---|
 * | `damage-rolled` | yes, in `pendingDamage` | Uncanny Dodge, Deflect Attacks, Cutting Words |
 * | `test-rolled` | yes, in `pendingTest` | Indomitable, Dark One's Own Luck, Peerless Skill, Cutting Words |
 * | `damaged-by-creature` | **no** — everything is settled | Retaliation |
 *
 * That third row is the one that proves the architecture rather than the
 * features: a Reaction that cannot change what provoked it needs no pending
 * state, and building one for it would have been a window with nothing in it.
 */

const id = (s: string) => asCharacterId(s);
const NYX = id('nyx'); // Rogue — Uncanny Dodge
const TAM = id('tam'); // Monk — Deflect Attacks / Deflect Energy
const ILVA = id('ilva'); // Bard (Lore) — Cutting Words / Peerless Skill
const BRAM = id('bram'); // Fighter — Indomitable
const VEK = id('vek'); // Warlock (Fiend) — Dark One's Own Luck
const GRIM = id('grim'); // Barbarian (Berserker) — Retaliation
const THUG = id('thug'); // somebody to hit and be hit by

const plain = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const common = {
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  equipped: [],
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  cantrips: [],
  preparedSpells: [],
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
};

const asi = (prefix: string, level: number, at: readonly number[]): Record<string, unknown> =>
  Object.fromEntries(
    at
      .filter((n) => level >= n)
      .map((_at, index) => [
        index === 0 ? `${prefix}:ability-score-improvement` : `${prefix}:ability-score-improvement-${index + 1}`,
        { featId: 'savage-attacker' },
      ]),
  );

const rogue = (level: number): CharacterChoices => ({
  ...common,
  name: 'Nyx',
  classId: 'rogue',
  level,
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['stealth', 'sleight-of-hand', 'acrobatics', 'investigation'],
  subclassId: 'thief',
  featureChoices: {
    'human:skillful': ['perception'],
    'rogue:expertise': ['stealth', 'sleight-of-hand'],
    ...(level >= 6 ? { 'rogue:second-expertise': ['acrobatics', 'investigation'] } : {}),
  },
  feats: { ...common.feats, ...asi('rogue', level, [4, 8]) },
});

const monk = (level: number): CharacterChoices => ({
  ...common,
  name: 'Tam',
  classId: 'monk',
  level,
  abilities: {
    method: 'manual',
    assignment: { str: 10, dex: 16, con: 13, int: 8, wis: 14, cha: 12 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['acrobatics', 'stealth'],
  subclassId: 'warrior-of-the-open-hand',
  featureChoices: { 'human:skillful': ['perception'] },
  feats: { ...common.feats, ...asi('monk', level, [4, 8, 12, 16]) },
});

const bard = (level: number): CharacterChoices => ({
  ...common,
  name: 'Ilva',
  classId: 'bard',
  level,
  abilities: {
    method: 'manual',
    assignment: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['persuasion', 'performance', 'deception'],
  subclassId: 'college-of-lore',
  featureChoices: {
    'human:skillful': ['perception'],
    'college-of-lore:bonus-proficiencies': ['arcana', 'history', 'insight'],
    'bard:expertise': ['persuasion', 'performance'],
    ...(level >= 9 ? { 'bard:second-expertise': ['deception', 'arcana'] } : {}),
  },
  cantrips: known('bard', level).cantrips,
  preparedSpells: known('bard', level).prepared,
  feats: { ...common.feats, ...asi('bard', level, [4, 8, 12, 16]) },
});

/**
 * Cantrips and prepared spells taken off the class's own table, rather than
 * transcribed into this fixture.
 *
 * A fixture that hard-codes "three cantrips at level 5" is a fixture that
 * breaks the first time a class table is corrected, and it would be testing
 * the transcription rather than the Reactions this file is about.
 */
function known(classId: string, level: number): { cantrips: string[]; prepared: string[] } {
  const definition = allClasses().find((c) => c.id === classId);
  if (definition === undefined) throw new Error(`no class called ${classId}`);
  const row = unwrap(rowAt(definition, level), `${classId} ${level}`);
  const highest = Object.keys(slotsAt(definition, level)).map(Number);
  const cap = highest.length === 0 ? 0 : Math.max(...highest);

  const list = spellsForClass(classId);
  const cantrips = list.filter((sp) => sp.level === 0).map((sp) => sp.id).sort();
  const levelled = list
    .filter((sp) => sp.level >= 1 && sp.level <= cap)
    .map((sp) => sp.id)
    .sort();

  return {
    cantrips: cantrips.slice(0, row.cantripsKnown ?? 0),
    prepared: levelled.slice(0, row.preparedSpells ?? 0),
  };
}

const fighter = (level: number): CharacterChoices => ({
  ...common,
  name: 'Bram',
  classId: 'fighter',
  level,
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, wis: 1 },
  classSkills: ['athletics', 'intimidation'],
  subclassId: 'champion',
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    ...common.feats,
    'fighter:fighting-style': { featId: 'defense' },
    ...(level >= 7 ? { 'champion:additional-fighting-style': { featId: 'archery' } } : {}),
    ...asi('fighter', level, [4, 6, 8, 12, 14, 16]),
  },
});

const warlock = (level: number): CharacterChoices => ({
  ...common,
  name: 'Vek',
  classId: 'warlock',
  level,
  abilities: {
    method: 'manual',
    assignment: { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 16 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['arcana', 'deception'],
  subclassId: 'fiend-patron',
  featureChoices: { 'human:skillful': ['perception'] },
  cantrips: known('warlock', level).cantrips,
  preparedSpells: known('warlock', level).prepared,
  feats: { ...common.feats, ...asi('warlock', level, [4, 8, 12, 16]) },
});

const barbarian = (level: number): CharacterChoices => ({
  ...common,
  name: 'Grim',
  classId: 'barbarian',
  level,
  abilities: {
    method: 'manual',
    assignment: { str: 16, dex: 14, con: 15, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  subclassId: 'path-of-the-berserker',
  featureChoices: { 'human:skillful': ['perception'], 'barbarian:primal-knowledge': ['intimidation'] },
  feats: { ...common.feats, ...asi('barbarian', level, [4, 8, 12, 16]) },
});

const sheetFor = (choices: CharacterChoices, what: string): CharacterSheet =>
  unwrap(planCharacter(choices), what).sheet;

const added = (
  who: CharacterId,
  side: string,
  character: CharacterSheet,
  maxHp = 80,
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: character,
  maxHp,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const pool = (who: CharacterId, key: string, label: string, max: number): GameEvent => ({
  type: 'resource-pool-declared',
  id: who,
  pool: { key, label, max, recovers: 'long-rest' },
});

const kit = (who: CharacterId, items: readonly string[]): GameEvent => ({
  type: 'items-gained',
  id: who,
  items: items.map((i) => ({ id: i, quantity: 1 })),
  source: 'kit',
});

const at = (who: CharacterId, from: CharacterId, feet: number, bearing = 0): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { creature: from }, feet, bearing },
});

const sees = (from: CharacterId, to: CharacterId, seen = true): GameEvent => ({
  type: 'sight-declared',
  from,
  to,
  seen,
});

interface Supply {
  readonly issuer: RollIssuer;
  readonly rng: Rng;
}

const supply = (seed = 'react'): Supply => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
});

/** A log that folds, with the helpers every test in this file wants. */
class Game {
  constructor(private readonly events: GameEvent[]) {}

  get state(): GameState {
    return fold('seed', this.events);
  }

  get log(): readonly GameEvent[] {
    return this.events;
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  hp(who: CharacterId): number {
    const creature = this.state.creatures[who];
    if (creature === undefined) throw new Error(`${who} is not in the game`);
    return creature.vitals.hp;
  }

  left(who: CharacterId, key: string): number {
    const creature = this.state.creatures[who];
    if (creature === undefined) throw new Error(`${who} is not in the game`);
    return remaining(creature.resources, key);
  }

  reaction(who: CharacterId): boolean {
    return this.state.combat?.budgets[who]?.reaction ?? true;
  }

  /** Fold every prefix, so a partially written log is never a special case. */
  foldsAtEveryPrefix(): void {
    for (let n = 0; n <= this.events.length; n += 1) {
      expect(() => fold('seed', this.events.slice(0, n))).not.toThrow();
    }
  }
}

const scene: readonly GameEvent[] = [
  { type: 'scene-set', extent: { width: 2000, depth: 2000, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 500, y: 500, z: 0 } },
];

/** The one thing in the log that says damage was held rather than dealt. */
const heldDamage = (events: readonly GameEvent[]) => {
  const found = events.find((e) => e.type === 'damage-rolled');
  return found?.type === 'damage-rolled' ? found.damage : null;
};


describe('the sheet carries the Reactions a class grants', () => {
  it('gives a Rogue 5 Uncanny Dodge and nothing before level 5', () => {
    expect((sheetFor(rogue(4), 'rogue 4').reactions ?? []).map((r) => r.feature)).toEqual([]);
    const five = sheetFor(rogue(5), 'rogue 5').reactions ?? [];
    expect(five.map((r) => r.feature)).toEqual(['rogue:uncanny-dodge']);
    expect(five[0]).toMatchObject({
      window: 'damage-rolled',
      costsReaction: true,
      pool: null,
      requiresSight: true,
      does: { kind: 'reduce-damage', amount: { halve: true }, fromAttackOnly: true },
    });
  });

  /**
   * SRD Deflect Attacks: "The reduction equals 1d10 plus your Dexterity
   * modifier **and Monk level**" — two addends on one feature, which is why
   * the amount carries a list where a self-heal carries one.
   */
  it('resolves the Monk level into Deflect Attacks at the level it is read', () => {
    for (const level of [3, 7, 13]) {
      const found = (sheetFor(monk(level), `monk ${level}`).reactions ?? []).find(
        (r) => r.feature === 'monk:deflect-attacks',
      );
      expect(found?.does).toMatchObject({
        kind: 'reduce-damage',
        amount: {
          dice: '1d10',
          plus: [
            { kind: 'ability', ability: 'dex' },
            { kind: 'level', level },
          ],
        },
      });
    }
  });

  /**
   * SRD Deflect Energy widens the list on Deflect Attacks rather than granting
   * a second Reaction. Two grants would offer a Monk 13 two answers to one
   * blow and let them deflect twice.
   */
  it('lets Deflect Energy widen the type list without adding a second Reaction', () => {
    const twelve = (sheetFor(monk(12), 'monk 12').reactions ?? []).filter(
      (r) => r.window === 'damage-rolled',
    );
    expect(twelve).toHaveLength(1);
    expect(twelve[0]?.does).toMatchObject({
      damageTypes: ['bludgeoning', 'piercing', 'slashing'],
    });

    const thirteen = (sheetFor(monk(13), 'monk 13').reactions ?? []).filter(
      (r) => r.window === 'damage-rolled',
    );
    expect(thirteen).toHaveLength(1);
    expect(thirteen[0]?.does).not.toHaveProperty('damageTypes');
  });

  /**
   * SRD Cutting Words answers "a damage roll **or** a success on an ability
   * check or attack roll" — one feature, one Reaction, two windows. So it is
   * filed under both, from one grant, and the window is derived from what each
   * effect acts on rather than declared beside it.
   */
  it('files Cutting Words under both windows from one grant', () => {
    const found = (sheetFor(bard(3), 'bard 3').reactions ?? []).filter(
      (r) => r.feature === 'college-of-lore:cutting-words',
    );
    expect(found.map((r) => r.window).sort()).toEqual(['damage-rolled', 'test-rolled']);
    for (const entry of found) {
      expect(entry.costsReaction).toBe(true);
      expect(entry.pool).toBe('bardic-inspiration');
      expect(entry.reach).toEqual({ kind: 'within', feet: 60 });
      expect(entry.requiresSight).toBe(true);
    }
  });

  /** The Bardic Inspiration die is a column of the class table, not a number. */
  it('reads the Bardic Inspiration die off the table', () => {
    const dieAt = (level: number): string | undefined => {
      const found = (sheetFor(bard(level), `bard ${level}`).reactions ?? []).find(
        (r) => r.feature === 'college-of-lore:cutting-words' && r.window === 'damage-rolled',
      );
      return found?.does.kind === 'reduce-damage' ? found.does.amount.dice : undefined;
    };
    expect(dieAt(3)).toBe('1d6');
    expect(dieAt(5)).toBe('1d8');
    expect(dieAt(10)).toBe('1d10');
    expect(dieAt(15)).toBe('1d12');
  });

  /**
   * SRD Indomitable spends **no Reaction**: it is a bare permission limited by
   * a pool. Treating the window and the action-economy cost as one thing is
   * the commonest mistake about this corner of the rules, and four of the
   * eight features here would be wrong under it.
   */
  it('knows which of these features actually cost a Reaction', () => {
    const costs = (choices: CharacterChoices, what: string, feature: string): boolean | undefined =>
      (sheetFor(choices, what).reactions ?? []).find((r) => r.feature === feature)?.costsReaction;

    expect(costs(rogue(5), 'rogue', 'rogue:uncanny-dodge')).toBe(true);
    expect(costs(monk(3), 'monk', 'monk:deflect-attacks')).toBe(true);
    expect(costs(bard(3), 'bard', 'college-of-lore:cutting-words')).toBe(true);
    expect(costs(barbarian(10), 'barbarian', 'berserker:retaliation')).toBe(true);

    expect(costs(fighter(9), 'fighter', 'fighter:indomitable')).toBe(false);
    expect(costs(warlock(6), 'warlock', 'fiend-patron:dark-ones-own-luck')).toBe(false);
    expect(costs(bard(14), 'bard 14', 'college-of-lore:peerless-skill')).toBe(false);
  });

  /**
   * SRD Indomitable: "twice before a Long Rest starting at level 13 and three
   * times before a Long Rest starting at level 17" — a pool, sized by a
   * sentence rather than by a printed column.
   */
  it('declares Indomitable as a pool that grows twice', () => {
    const uses = (level: number): number => {
      const built = unwrap(createCharacter(fighter(level), BRAM), `fighter ${level}`);
      const declared = built.find(
        (e) => e.type === 'resource-pool-declared' && e.pool.key === 'fighter:indomitable',
      );
      return declared?.type === 'resource-pool-declared' ? declared.pool.max : -1;
    };
    expect(uses(9)).toBe(1);
    expect(uses(12)).toBe(1);
    expect(uses(13)).toBe(2);
    expect(uses(17)).toBe(3);
  });

  /**
   * SRD Dark One's Own Luck: "a number of times equal to your Charisma
   * modifier (minimum of once)" — the ability-modifier sizing, read by the
   * same function every other pool uses.
   */
  it("sizes Dark One's Own Luck off Charisma", () => {
    const built = unwrap(createCharacter(warlock(6), VEK), 'warlock 6');
    const declared = built.find(
      (e) =>
        e.type === 'resource-pool-declared' && e.pool.key === 'fiend-patron:dark-ones-own-luck',
    );
    // 16 Charisma, untouched by the Sage increases, so a +3 modifier.
    expect(declared?.type === 'resource-pool-declared' ? declared.pool.max : -1).toBe(3);
  });
});

// — the damage window ————————————————————————————————————————————————————————

/**
 * A Rogue, a Thug with a longsword, and a fight in which the Thug swings.
 *
 * Everything is *declared*: the scene, both positions, the sight line. An
 * undeclared sight line is a separate case and has its own test, because
 * "nobody has said" and "cannot see" are different answers.
 */
const duel = (
  defender: CharacterId,
  sheet: CharacterSheet,
  options: { readonly sight?: boolean; readonly combat?: boolean; readonly feet?: number } = {},
): GameEvent[] => [
  added(defender, 'party', sheet),
  added(THUG, 'thugs', plain()),
  kit(THUG, ['longsword']),
  { type: 'item-equipped', id: THUG, item: 'longsword' },
  ...scene,
  { type: 'creature-placed', id: defender, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  at(THUG, defender, options.feet ?? 5, 0),
  ...(options.sight === false ? [] : [sees(defender, THUG), sees(THUG, defender)]),
  ...(options.combat === false
    ? []
    : [
        {
          type: 'combat-started' as const,
          combatants: [
            { id: THUG, initiative: 20, speed: 30 },
            { id: defender, initiative: 10, speed: 30 },
          ],
        },
      ]),
];

/** Swing with the roll forced to land, so the test is about what follows it. */
const swing = (
  game: Game,
  target: CharacterId,
  seed = 'hit',
  attacker: CharacterId = THUG,
): AttackResolution => {
  const out = unwrap(
    resolveAttack(
      game.state,
      attacker,
      { target, weapon: 'longsword', attackBonuses: [{ source: 'forced', flat: 40 }] },
      supply(seed),
    ),
    'attack',
  );
  if (out.attack?.hit !== true) throw new Error('the fixture meant this swing to land');
  game.push(out.events);
  return out;
};

describe('the damage window opens only when somebody can answer it', () => {
  /**
   * The decision that keeps an ordinary attack an ordinary attack. If every
   * damage roll became a two-command negotiation, every swing in the engine
   * would pay for a moment that is almost always empty — and `scenario.test.ts`
   * and the frozen golden log would both have had to change.
   */
  it('deals the damage in one call when nobody has a Reaction for it', () => {
    const g = new Game(duel(NYX, plain()));
    const out = swing(g, NYX);

    expect(out.events.some((e) => e.type === 'damage-rolled')).toBe(false);
    expect(out.damage).toBeGreaterThan(0);
    expect(out.reactions).toBeUndefined();
    expect(g.state.pendingDamage).toBeNull();
  });

  /** And holds it when somebody does. */
  it('holds the damage when the target could reduce it', () => {
    const g = new Game(duel(NYX, sheetFor(rogue(5), 'rogue 5')));
    const out = swing(g, NYX);

    const held = heldDamage(out.events);
    expect(held?.target).toBe(NYX);
    expect(held?.by).toBe(THUG);
    expect(held?.fromAttack).toBe(true);
    expect(held?.reductions).toEqual([]);
    expect(out.damage).toBeUndefined();
    expect(out.reactions?.map((o) => o.feature)).toEqual(['rogue:uncanny-dodge']);

    // Nothing has moved. That is the whole claim of this window.
    expect(g.hp(NYX)).toBe(80);
    expect(g.state.pendingDamage?.offers).toHaveLength(1);
  });

  /**
   * SRD Uncanny Dodge: "an attacker **that you can see**". Declared unseen is a
   * refusal; undeclared is a fact nobody has established, and withholding a
   * whole Reaction on that basis would be the engine deciding it.
   */
  it('withholds the offer from a Rogue who cannot see the attacker, and says so when nobody has said', () => {
    const blind = new Game([
      ...duel(NYX, sheetFor(rogue(5), 'rogue 5'), { sight: false }),
      sees(NYX, THUG, false),
    ]);
    expect(swing(blind, NYX).reactions).toBeUndefined();

    const unsaid = new Game(duel(NYX, sheetFor(rogue(5), 'rogue 5'), { sight: false }));
    const out = swing(unsaid, NYX);
    expect(out.reactions).toHaveLength(1);
    expect(out.unverified.join(' ')).toContain('nobody has said whether nyx can see thug');
  });

  /**
   * SRD: "When an **attack roll** hits you". Damage from anything else is not
   * Uncanny Dodge's trigger, and the engine has to be able to tell.
   */
  it('offers nothing to a Rogue hurt by something that made no attack roll', () => {
    const g = new Game(duel(NYX, sheetFor(rogue(5), 'rogue 5')));
    const out = unwrap(
      resolveDamage(g.state, NYX, { amount: 12, source: 'a falling rock' }, supply()),
      'rock',
    );
    expect(out.events.some((e) => e.type === 'damage-rolled')).toBe(false);
  });

  /** And a Rogue with no Reaction left is offered nothing. */
  it('offers nothing to a Rogue who has already spent their Reaction', () => {
    const g = new Game([
      ...duel(NYX, sheetFor(rogue(5), 'rogue 5')),
      { type: 'reaction-spent', id: NYX },
    ]);
    expect(swing(g, NYX).reactions).toBeUndefined();
  });
});

describe('Uncanny Dodge', () => {
  const built = () => new Game(duel(NYX, sheetFor(rogue(5), 'rogue 5')));

  /**
   * The whole path, end to end: a hit, an offer, the Reaction spent, the
   * halving, and the damage that finally lands.
   */
  it('halves the damage, spends the Reaction, and lands the rest', () => {
    const g = built();
    const rolled = heldDamage(swing(g, NYX).events);
    const before = rolled!.components.reduce((sum, c) => sum + c.total, 0);

    expect(g.reaction(NYX)).toBe(true);
    g.push(
      unwrap(
        takeDamageReaction(g.state, NYX, { feature: 'rogue:uncanny-dodge' }, supply()),
        'dodge',
      ).events,
    );
    expect(g.reaction(NYX)).toBe(false);
    expect(g.state.pendingDamage?.reductions).toHaveLength(1);
    // Still nothing dealt: the window is answered, not settled.
    expect(g.hp(NYX)).toBe(80);

    const settled = unwrap(settleDamage(g.state, supply()), 'settle');
    g.push(settled.events);

    // SRD: "halve the attack's damage against you (**round down**)".
    expect(settled.amount).toBe(Math.floor(before / 2));
    expect(g.hp(NYX)).toBe(80 - Math.floor(before / 2));
    expect(g.state.pendingDamage).toBeNull();
  });

  /** Nobody reacts, and the blow lands whole. */
  it('lands in full when the Rogue declines', () => {
    const g = built();
    const rolled = heldDamage(swing(g, NYX).events);
    const before = rolled!.components.reduce((sum, c) => sum + c.total, 0);

    g.push(unwrap(declineDamageReaction(g.state, NYX, {}), 'decline'));
    expect(g.reaction(NYX)).toBe(true);

    const settled = unwrap(settleDamage(g.state, supply()), 'settle');
    expect(settled.amount).toBe(before);
  });

  /** And settling with nobody having answered records the pass. */
  it('records an unanswered offer as a pass', () => {
    const g = built();
    swing(g, NYX);
    const settled = unwrap(settleDamage(g.state, supply()), 'settle');
    expect(
      settled.events.filter((e) => e.type === 'damage-reaction-answered' && !e.took),
    ).toHaveLength(1);
    g.push(settled.events);
    expect(g.reaction(NYX)).toBe(true);
  });

  /**
   * SRD "Order of Application": adjustments first, Resistance second. A Rogue
   * with Resistance who dodges takes a **quarter**, and the order is
   * observable — halving 13 to 7 and then resisting gives 3, where resisting
   * first gives 6 halved to 3... which is why the test uses a number where the
   * two disagree.
   */
  /**
   * SRD "Order of Application": "adjustments such as bonuses, penalties, **or
   * multipliers** are applied first; Resistance is applied second."
   *
   * The order is observable and the numbers are chosen so that the two
   * readings disagree. Nine Slashing against a Rogue resistant to Slashing:
   *
   * | | |
   * |---|---|
   * | adjustment first | 9 → halved to 4 → resisted to **2** |
   * | Resistance first | 9 → resisted to 4 → halved to **2**… |
   *
   * — which is why the test uses a *flat* reduction beside the halving, where
   * the two orders give 2 and 0. A fixture without a resistant target proves
   * nothing here at all, which is exactly how a mutation that reordered the
   * two once survived the whole suite.
   */
  it('applies a reduction before Resistance, which is what the order means', () => {
    const held = (amount: number): PendingDamage => ({
      target: TAM,
      by: THUG,
      source: 'Longsword',
      components: [{ source: 'Longsword', type: 'slashing', roll: null, flat: amount, total: amount }],
      critical: false,
      fromAttack: true,
      reductions: [],
      offers: [
        {
          reactor: TAM,
          feature: 'monk:deflect-attacks',
          name: 'Deflect Attacks',
          costsReaction: true,
          pool: null,
        },
      ],
    });

    // A Monk 1 would have no Deflect Attacks; a Monk 3 reduces by 1d10 + Dex
    // + 3, which is at least 7 against 9 Slashing — so Resistance-first gives
    // 0 and adjustment-first gives something above it.
    const g = new Game([
      {
        type: 'creature-added',
        id: TAM,
        name: TAM,
        sheet: sheetFor(monk(3), 'monk 3'),
        maxHp: 80,
        diesAtZero: false,
        creatureType: 'Humanoid',
        side: 'party',
        defenses: { slashing: { resistant: true } },
      },
      added(THUG, 'thugs', plain()),
      { type: 'damage-rolled', damage: held(30) },
    ]);

    const out = unwrap(
      takeDamageReaction(g.state, TAM, { feature: 'monk:deflect-attacks' }, supply('order')),
      'deflect',
    );
    g.push(out.events);
    const taken = out.reduction!.amount;

    // Adjustment first: (30 − taken) halved. Resistance first would be
    // max(0, 15 − taken), and the two differ for every value the die can take.
    expect(unwrap(settleDamage(g.state, supply()), 'settle').amount).toBe(
      Math.floor((30 - taken) / 2),
    );
    expect(Math.floor((30 - taken) / 2)).not.toBe(Math.max(0, 15 - taken));
  });
});

describe('Deflect Attacks', () => {
  const built = (level = 3) => new Game(duel(TAM, sheetFor(monk(level), `monk ${level}`)));

  /**
   * SRD: "The reduction equals 1d10 plus your Dexterity modifier and Monk
   * level." Asserted against the die the log recorded rather than a number a
   * seed produced — the arithmetic is the claim.
   */
  it('reduces by the die plus Dexterity and the Monk level, and the log says which is which', () => {
    const g = built(7);
    const rolled = heldDamage(swing(g, TAM).events);
    const before = rolled!.components.reduce((sum, c) => sum + c.total, 0);

    const out = unwrap(
      takeDamageReaction(g.state, TAM, { feature: 'monk:deflect-attacks' }, supply()),
      'deflect',
    );
    const record = out.events.find((e) => e.type === 'roll-recorded');
    if (record?.type !== 'roll-recorded') throw new Error('no roll was recorded');

    // 16 Dexterity → +3, plus 7 Monk levels.
    expect(record.contributions).toEqual([
      { source: '1d10', amount: record.natural },
      { source: 'Dexterity', amount: 3 },
      { source: 'Monk level', amount: 7 },
    ]);
    expect(out.reduction?.amount).toBe(record.natural + 3 + 7);

    g.push(out.events);
    const settled = unwrap(settleDamage(g.state, supply()), 'settle');
    expect(settled.amount).toBe(Math.max(0, before - (record.natural + 3 + 7)));
  });

  /**
   * SRD: "and its damage **includes** Bludgeoning, Piercing, or Slashing
   * damage." A Monk 3 hit by pure Fire is not offered the Reaction; a Monk 13
   * is, because Deflect Energy widens the list rather than granting a second
   * Reaction.
   */
  it('answers only the damage types its own sentence names, until Deflect Energy widens them', () => {
    const fire: DamageComponent[] = [
      { source: 'a flaming brand', type: 'fire', roll: null, flat: 10, total: 10 },
    ];
    for (const [level, offered] of [
      [3, false],
      [13, true],
    ] as const) {
      const state = fold('seed', duel(TAM, sheetFor(monk(level), `monk ${level}`)));
      const offers = offersForDamage(state, {
        target: TAM,
        by: THUG,
        fromAttack: true,
        damageTypes: fire.map((c) => c.type),
      });
      expect(offers.offers.length > 0, `monk ${level}`).toBe(offered);
    }
  });

  /** A reduction below zero is zero; damage never goes negative. */
  it('cannot reduce damage below nothing', () => {
    const g = built(13);
    const held: PendingDamage = {
      target: TAM,
      by: THUG,
      source: 'Longsword',
      components: [{ source: 'Longsword', type: 'slashing', roll: null, flat: 2, total: 2 }],
      critical: false,
      fromAttack: true,
      reductions: [],
      offers: [
        {
          reactor: TAM,
          feature: 'monk:deflect-attacks',
          name: 'Deflect Attacks',
          costsReaction: true,
          pool: null,
        },
      ],
    };
    g.push([{ type: 'damage-rolled', damage: held }]);
    g.push(
      unwrap(
        takeDamageReaction(g.state, TAM, { feature: 'monk:deflect-attacks' }, supply()),
        'deflect',
      ).events,
    );
    expect(unwrap(settleDamage(g.state, supply()), 'settle').amount).toBe(0);
  });
});

describe('Cutting Words', () => {
  /**
   * A Bard sixty feet away, answering somebody else's roll. The first feature
   * in this file whose reactor is neither the attacker nor the target, which
   * is what the `within` reach exists for.
   */
  const table = (feet = 30): GameEvent[] => [
    ...duel(NYX, plain(), { combat: false }),
    added(ILVA, 'party', sheetFor(bard(5), 'bard 5')),
    // `creature-added` carries a sheet and no pools; creation declares those,
    // and how big this one is at what Charisma is pinned by its own test
    // above. Three, so a test can spend them all and watch the offer vanish.
    pool(ILVA, 'bardic-inspiration', 'Bardic Inspiration', 3),
    at(ILVA, THUG, feet, 90),
    sees(ILVA, THUG),
    sees(ILVA, NYX),
    // The Bard is in the fight, or they have no Reaction to spend: a creature
    // outside the Initiative order has no budget, which is the engine's
    // reading of an economy that only exists in combat.
    {
      type: 'combat-started',
      combatants: [
        { id: THUG, initiative: 20, speed: 30 },
        { id: NYX, initiative: 10, speed: 30 },
        { id: ILVA, initiative: 5, speed: 30 },
      ],
    },
  ];

  it('lets a Bard cut a blow aimed at somebody else', () => {
    const g = new Game(table());
    const out = swing(g, NYX);
    expect(out.reactions?.map((o) => o.reactor)).toEqual([ILVA]);

    const before = g.left(ILVA, 'bardic-inspiration');
    const cut = unwrap(
      takeDamageReaction(
        g.state,
        ILVA,
        { feature: 'college-of-lore:cutting-words' },
        supply('cut'),
      ),
      'cut',
    );
    g.push(cut.events);

    // SRD: "expend one use of your Bardic Inspiration" — and a Reaction too.
    expect(g.left(ILVA, 'bardic-inspiration')).toBe(before - 1);
    expect(g.reaction(ILVA)).toBe(false);
    // A d8 at Bard 5.
    expect(cut.reduction?.amount).toBeGreaterThanOrEqual(1);
    expect(cut.reduction?.amount).toBeLessThanOrEqual(8);
  });

  /** SRD: "**within 60 feet** of yourself". */
  it('is not offered from further than sixty feet', () => {
    const g = new Game(table(65));
    expect(swing(g, NYX).reactions).toBeUndefined();
  });

  /** SRD: "a creature that **you can see**". */
  it('is not offered to a Bard who cannot see the roller', () => {
    const g = new Game([...table(), sees(ILVA, THUG, false)]);
    expect(swing(g, NYX).reactions).toBeUndefined();
  });

  /**
   * A Bard may perfectly well cut the blow aimed at themselves — the "creature
   * you can see" is whoever made the roll, not whoever is being hit.
   */
  it('may be used on damage aimed at the Bard', () => {
    const g = new Game([
      ...duel(ILVA, sheetFor(bard(5), 'bard 5')),
      pool(ILVA, 'bardic-inspiration', 'Bardic Inspiration', 3),
    ]);
    expect(swing(g, ILVA).reactions?.map((o) => o.reactor)).toEqual([ILVA]);
  });

  /** And with no uses left the offer is withheld rather than refused later. */
  it('is not offered when the Bardic Inspiration is spent', () => {
    const g = new Game([
      ...table(),
      { type: 'resource-spent', id: ILVA, key: 'bardic-inspiration', amount: 3 },
    ]);
    expect(g.left(ILVA, 'bardic-inspiration')).toBe(0);
    expect(swing(g, NYX).reactions).toBeUndefined();
  });
});

describe('two reactors on one blow', () => {
  /**
   * SRD gives no rule for sequencing two voluntary Reactions, and the order is
   * observable: halving a total and then subtracting 3 is not the same as
   * subtracting 3 and then halving.
   *
   * So the engine does not choose. **Whoever answers first is applied first**,
   * and the log records the order. That is the smallest deterministic protocol
   * that does not invent a rule.
   */
  const table = (): GameEvent[] => [
    ...duel(NYX, sheetFor(rogue(5), 'rogue 5'), { combat: false }),
    added(ILVA, 'party', sheetFor(bard(5), 'bard 5')),
    pool(ILVA, 'bardic-inspiration', 'Bardic Inspiration', 3),
    at(ILVA, THUG, 30, 90),
    sees(ILVA, THUG),
    {
      type: 'combat-started',
      combatants: [
        { id: THUG, initiative: 20, speed: 30 },
        { id: NYX, initiative: 10, speed: 30 },
        { id: ILVA, initiative: 5, speed: 30 },
      ],
    },
  ];

  it('offers both, in a stable order', () => {
    const g = new Game(table());
    const out = swing(g, NYX);
    expect(out.reactions?.map((o) => `${o.reactor}:${o.feature}`)).toEqual([
      'ilva:college-of-lore:cutting-words',
      'nyx:rogue:uncanny-dodge',
    ]);
  });

  it('will not settle while one of them still owes an answer', () => {
    const g = new Game(table());
    swing(g, NYX);
    g.push(
      unwrap(
        takeDamageReaction(g.state, NYX, { feature: 'rogue:uncanny-dodge' }, supply()),
        'dodge',
      ).events,
    );
    // One offer left; the turn may not move on.
    expect(g.state.pendingDamage?.offers).toHaveLength(1);
    const advance = resolveTurn(g.state, supply());
    expect(isErr(advance) ? advance.code : 'ok').toBe('damage_pending');
  });

  /**
   * The order is the caller's and the arithmetic follows it. Cutting first and
   * halving second gives a different number from halving first, and both are
   * legal readings of a rule the SRD never wrote.
   */
  it('applies the reductions in the order they were answered', () => {
    const order = (first: CharacterId, second: CharacterId): number => {
      const g = new Game(table());
      // A fixed damage roll, so the only difference between the two runs is
      // the order two Reactions were taken in.
      g.push([
        {
          type: 'damage-rolled',
          damage: {
            target: NYX,
            by: THUG,
            source: 'Longsword',
            components: [
              { source: 'Longsword', type: 'slashing', roll: null, flat: 16, total: 16 },
            ],
            critical: false,
            fromAttack: true,
            reductions: [],
            offers: [
              {
                reactor: ILVA,
                feature: 'college-of-lore:cutting-words',
                name: 'Cutting Words',
                costsReaction: true,
                pool: 'bardic-inspiration',
              },
              {
                reactor: NYX,
                feature: 'rogue:uncanny-dodge',
                name: 'Uncanny Dodge',
                costsReaction: true,
                pool: null,
              },
            ],
          },
        },
      ]);

      const featureOf = (who: CharacterId) =>
        who === NYX ? 'rogue:uncanny-dodge' : 'college-of-lore:cutting-words';
      for (const who of [first, second]) {
        g.push(
          unwrap(
            takeDamageReaction(g.state, who, { feature: featureOf(who) }, supply('fixed')),
            'react',
          ).events,
        );
      }
      return unwrap(settleDamage(g.state, supply()), 'settle').amount;
    };

    const dodgeFirst = order(NYX, ILVA);
    const cutFirst = order(ILVA, NYX);
    // Same die (the same seed), different order, different answer. The engine
    // records which happened rather than normalising it away.
    expect(dodgeFirst).not.toBe(cutFirst);
  });
});

// — the D20 Test window ——————————————————————————————————————————————————————

/**
 * A saving throw or an ability check, asked for directly.
 *
 * `rollAbilityCheck` and `rollSavingThrow` were complete and correct and
 * reachable from no command at all except inside a spell's own resolution —
 * the ninth instance in this codebase of a pure function nothing calls. A DM
 * asks for a save constantly and the engine had no way to be asked.
 */
describe('resolveTest', () => {
  const alone = (who: CharacterId, sheet: CharacterSheet): GameEvent[] => [
    added(who, 'party', sheet),
  ];

  it('rolls a saving throw and records it, with nothing held open', () => {
    const g = new Game(alone(BRAM, sheetFor(fighter(9), 'fighter 9')));
    // Level 9 Fighter, Indomitable in hand — but this is a *check*, and
    // Indomitable answers a saving throw.
    const out = unwrap(
      resolveTest(g.state, BRAM, { kind: 'ability-check', ability: 'dex', dc: 15 }, supply()),
      'check',
    );
    expect(out.test).not.toBeNull();
    expect(out.offers).toEqual([]);
    g.push(out.events);
    expect(g.state.pendingTest).toBeNull();
  });

  it('refuses a Difficulty Class that is not a number', () => {
    const g = new Game(alone(BRAM, plain()));
    const out = resolveTest(
      g.state,
      BRAM,
      { kind: 'saving-throw', ability: 'dex', dc: Number.NaN },
      supply(),
    );
    expect(isErr(out) ? out.code : 'ok').toBe('bad_dc');
  });

  /** A creature nobody has declared is homework, not a verdict. */
  it('asks about a creature nobody has mentioned', () => {
    const out = resolveTest(
      fold('seed', alone(BRAM, plain())),
      id('the-squire'),
      { kind: 'saving-throw', ability: 'dex', dc: 10 },
      supply(),
    );
    expect(isErr(out) ? out.kind : 'ok').toBe('needs-context');
  });
});

describe('Indomitable', () => {
  const built = (level = 9): GameEvent[] => [
    added(BRAM, 'party', sheetFor(fighter(level), `fighter ${level}`)),
    pool(BRAM, 'fighter:indomitable', 'Indomitable', level >= 17 ? 3 : level >= 13 ? 2 : 1),
  ];

  /** A DC nothing can reach, so the save fails and the window opens. */
  const failing = (g: Game, seed = 'save') =>
    unwrap(
      resolveTest(g.state, BRAM, { kind: 'saving-throw', ability: 'dex', dc: 40 }, supply(seed)),
      'save',
    );

  it('is offered on a failed save and not on a successful one', () => {
    const g = new Game(built());
    expect(failing(g).offers.map((o) => o.feature)).toEqual(['fighter:indomitable']);

    const easy = unwrap(
      resolveTest(g.state, BRAM, { kind: 'saving-throw', ability: 'dex', dc: -5 }, supply()),
      'save',
    );
    expect(easy.test?.success).toBe(true);
    expect(easy.offers).toEqual([]);
  });

  /** SRD Indomitable answers a saving throw and says nothing about checks. */
  it('is not offered on a failed ability check', () => {
    const g = new Game(built());
    const out = unwrap(
      resolveTest(g.state, BRAM, { kind: 'ability-check', ability: 'dex', dc: 40 }, supply()),
      'check',
    );
    expect(out.test?.success).toBe(false);
    expect(out.offers).toEqual([]);
  });

  /**
   * SRD: "reroll it with a bonus equal to your Fighter level. **You must use
   * the new roll**." Not take-the-better-of-two: a reroll that comes up worse
   * stands, and the superseded number is kept so the log shows what was given
   * up.
   */
  it('rerolls with the Fighter level, keeps the new roll, and remembers the old one', () => {
    const g = new Game(built());
    const first = failing(g);
    g.push(first.events);

    const again = unwrap(
      takeTestReaction(g.state, BRAM, { feature: 'fighter:indomitable' }, supply('again')),
      'reroll',
    );
    g.push(again.events);

    expect(again.test?.supersedes).toEqual({
      natural: first.test!.natural,
      total: first.test!.total,
    });
    // The bonus is the Fighter level, on top of the save's own modifier.
    expect(again.test!.total).toBe(again.test!.natural + first.test!.modifier + 9);
    expect(g.state.pendingTest?.result.natural).toBe(again.test!.natural);
    // Spent a use; spent no Reaction, because the SRD asks for none.
    expect(g.left(BRAM, 'fighter:indomitable')).toBe(0);
  });

  it('spends no Reaction, because the SRD does not ask for one', () => {
    const g = new Game([
      ...built(),
      {
        type: 'combat-started',
        combatants: [{ id: BRAM, initiative: 10, speed: 30 }],
      },
    ]);
    g.push(failing(g).events);
    g.push(
      unwrap(takeTestReaction(g.state, BRAM, { feature: 'fighter:indomitable' }, supply()), 'r')
        .events,
    );
    expect(g.reaction(BRAM)).toBe(true);
  });

  /** With the pool empty the offer is withheld rather than refused later. */
  it('is not offered with the pool spent', () => {
    const g = new Game([
      ...built(),
      { type: 'resource-spent', id: BRAM, key: 'fighter:indomitable', amount: 1 },
    ]);
    expect(failing(g).offers).toEqual([]);
  });
});

describe("Dark One's Own Luck", () => {
  const built = (): GameEvent[] => [
    added(VEK, 'party', sheetFor(warlock(6), 'warlock 6')),
    pool(VEK, 'fiend-patron:dark-ones-own-luck', "Dark One's Own Luck", 3),
  ];

  /**
   * SRD: "When you make an ability check **or a saving throw**... You can do so
   * after seeing the roll but before any of the roll's effects occur." It says
   * nothing about the outcome, so either one is answerable — which is what
   * separates it from Indomitable in the same window.
   */
  it('answers a check or a save, succeeded or failed', () => {
    for (const kind of ['ability-check', 'saving-throw'] as const) {
      for (const dc of [40, -5]) {
        const g = new Game(built());
        const out = unwrap(resolveTest(g.state, VEK, { kind, ability: 'dex', dc }, supply()), 't');
        expect(out.offers.map((o) => o.feature), `${kind} dc ${dc}`).toEqual([
          'fiend-patron:dark-ones-own-luck',
        ]);
      }
    }
  });

  it('adds 1d10 to the roll and spends a use', () => {
    const g = new Game(built());
    const first = unwrap(
      resolveTest(g.state, VEK, { kind: 'saving-throw', ability: 'wis', dc: 25 }, supply()),
      'save',
    );
    g.push(first.events);

    const pushed = unwrap(
      takeTestReaction(
        g.state,
        VEK,
        { feature: 'fiend-patron:dark-ones-own-luck' },
        supply('luck'),
      ),
      'luck',
    );
    g.push(pushed.events);

    const added = pushed.test!.total - first.test!.total;
    expect(added).toBeGreaterThanOrEqual(1);
    expect(added).toBeLessThanOrEqual(10);
    expect(g.left(VEK, 'fiend-patron:dark-ones-own-luck')).toBe(2);
  });

  /**
   * SRD: "you can use it **no more than once per roll**." The offer is spent
   * when it is answered, so a second use of the same feature on the same roll
   * is impossible rather than merely forbidden.
   */
  it('cannot be used twice on the same roll', () => {
    const g = new Game(built());
    g.push(
      unwrap(
        resolveTest(g.state, VEK, { kind: 'saving-throw', ability: 'wis', dc: 25 }, supply()),
        'save',
      ).events,
    );
    g.push(
      unwrap(
        takeTestReaction(g.state, VEK, { feature: 'fiend-patron:dark-ones-own-luck' }, supply()),
        'once',
      ).events,
    );
    const twice = takeTestReaction(
      g.state,
      VEK,
      { feature: 'fiend-patron:dark-ones-own-luck' },
      supply(),
    );
    expect(isErr(twice) ? twice.code : 'ok').toBe('not_offered');
  });
});

describe('Peerless Skill', () => {
  const built = (): GameEvent[] => [
    added(ILVA, 'party', sheetFor(bard(14), 'bard 14')),
    pool(ILVA, 'bardic-inspiration', 'Bardic Inspiration', 3),
  ];

  /**
   * SRD: "**On a failure, the Bardic Inspiration isn't expended.**"
   *
   * The only feature here whose cost depends on whether it worked, which is
   * why the spend is decided after the new total is known rather than before
   * it. Two DCs, one just out of reach of the die and one well inside it.
   */
  it('keeps the use when the die does not save the check', () => {
    const hopeless = new Game(built());
    hopeless.push(
      unwrap(
        resolveTest(
          hopeless.state,
          ILVA,
          { kind: 'ability-check', ability: 'cha', skill: 'persuasion', dc: 60 },
          supply(),
        ),
        'check',
      ).events,
    );
    const out = unwrap(
      takeTestReaction(
        hopeless.state,
        ILVA,
        { feature: 'college-of-lore:peerless-skill' },
        supply('p'),
      ),
      'peerless',
    );
    expect(out.test?.success).toBe(false);
    expect(out.events.some((e) => e.type === 'resource-spent')).toBe(false);
    hopeless.push(out.events);
    expect(hopeless.left(ILVA, 'bardic-inspiration')).toBe(3);
  });

  it('spends the use when the die turns the failure into a success', () => {
    // Rolled twice with the same seed, so the die is identical and the only
    // thing that changes is a DC set one above what it came to. Any face of
    // the d12 then turns the failure, which is what makes this deterministic
    // rather than a seed that happened to be kind.
    const probe = new Game(built());
    const scouted = unwrap(
      resolveTest(
        probe.state,
        ILVA,
        { kind: 'ability-check', ability: 'cha', skill: 'persuasion', dc: 99 },
        supply('near'),
      ),
      'probe',
    );

    const g = new Game(built());
    const near = unwrap(
      resolveTest(
        g.state,
        ILVA,
        {
          kind: 'ability-check',
          ability: 'cha',
          skill: 'persuasion',
          dc: scouted.test!.total + 1,
        },
        supply('near'),
      ),
      'check',
    );
    g.push(near.events);
    expect(near.test?.success).toBe(false);
    expect(near.test?.margin).toBe(-1);

    const out = unwrap(
      takeTestReaction(g.state, ILVA, { feature: 'college-of-lore:peerless-skill' }, supply('win')),
      'peerless',
    );
    expect(out.test?.success).toBe(true);
    expect(out.events.some((e) => e.type === 'resource-spent')).toBe(true);
    g.push(out.events);
    expect(g.left(ILVA, 'bardic-inspiration')).toBe(2);
  });
});

describe('Cutting Words on a D20 Test', () => {
  const table = (): GameEvent[] => [
    added(NYX, 'party', plain()),
    added(ILVA, 'thugs', sheetFor(bard(5), 'bard 5')),
    pool(ILVA, 'bardic-inspiration', 'Bardic Inspiration', 3),
    ...scene,
    { type: 'creature-placed', id: NYX, placement: { from: { landmark: 'the hall' }, feet: 0 } },
    at(ILVA, NYX, 30, 0),
    sees(ILVA, NYX),
  ];

  /**
   * SRD: "when a creature ... **succeeds on** an ability check". A failure is
   * nothing to cut, which is the mirror of Indomitable's "if you fail".
   */
  it('answers a success and not a failure', () => {
    const g = new Game(table());
    const won = unwrap(
      resolveTest(g.state, NYX, { kind: 'ability-check', ability: 'str', dc: -5 }, supply()),
      'check',
    );
    expect(won.offers.map((o) => o.reactor)).toEqual([ILVA]);

    const lost = unwrap(
      resolveTest(g.state, NYX, { kind: 'ability-check', ability: 'str', dc: 40 }, supply()),
      'check',
    );
    expect(lost.offers).toEqual([]);
  });

  /** And it subtracts, turning a success into a failure when the die is enough. */
  it('subtracts the die from the roll', () => {
    const g = new Game(table());
    const won = unwrap(
      resolveTest(g.state, NYX, { kind: 'ability-check', ability: 'str', dc: -5 }, supply()),
      'check',
    );
    g.push(won.events);

    const cut = unwrap(
      takeTestReaction(g.state, ILVA, { feature: 'college-of-lore:cutting-words' }, supply('cut')),
      'cut',
    );
    expect(cut.test!.total).toBeLessThan(won.test!.total);
    expect(won.test!.total - cut.test!.total).toBeGreaterThanOrEqual(1);
    expect(won.test!.total - cut.test!.total).toBeLessThanOrEqual(8);
  });
});

// — the settled window ————————————————————————————————————————————————————————

describe('Retaliation', () => {
  /**
   * The row that proves the architecture rather than the feature.
   *
   * SRD: "When you take damage from a creature that is within 5 feet of you,
   * you can take a Reaction to make one melee attack against that creature."
   * Everything is settled before the Reaction happens — the hit points have
   * moved and nothing the Barbarian does can change that — so **no pending
   * state exists**, and building a window for it would have been a window with
   * nothing in it.
   */
  const table = (feet = 5): GameEvent[] => [
    added(GRIM, 'party', sheetFor(barbarian(10), 'barbarian 10'), 100),
    added(THUG, 'thugs', plain()),
    kit(GRIM, ['greataxe']),
    { type: 'item-equipped', id: GRIM, item: 'greataxe' },
    ...scene,
    { type: 'creature-placed', id: GRIM, placement: { from: { landmark: 'the hall' }, feet: 0 } },
    at(THUG, GRIM, feet, 0),
    sees(GRIM, THUG),
    sees(THUG, GRIM),
    {
      type: 'combat-started',
      combatants: [
        { id: THUG, initiative: 20, speed: 30 },
        { id: GRIM, initiative: 10, speed: 30 },
      ],
    },
  ];

  const hurt = (g: Game): Game =>
    g.push(
      unwrap(
        resolveDamage(g.state, GRIM, { amount: 9, source: 'Longsword', by: THUG }, supply()),
        'damage',
      ).events,
    );

  it('swings back, spends the Reaction, and holds nothing open', () => {
    const g = hurt(new Game(table()));
    expect(g.state.pendingDamage).toBeNull();

    const out = unwrap(
      takeDamageResponse(
        g.state,
        GRIM,
        { feature: 'berserker:retaliation', weapon: 'greataxe' },
        supply('swing'),
      ),
      'retaliate',
    );
    g.push(out.events);

    expect(out.attack).not.toBeNull();
    expect(g.reaction(GRIM)).toBe(false);
    // The Attack action is untouched — the Reaction is what this cost.
    expect(g.state.combat?.budgets[GRIM]?.action).toBe(true);
    expect(g.state.pendingDamage).toBeNull();
    expect(
      out.events.some((e) => e.type === 'reaction-taken' && e.window === 'damaged-by-creature'),
    ).toBe(true);
  });

  /** SRD: "**that creature**" — the target is forced by the trigger. */
  it('swings at the creature that dealt the damage', () => {
    const g = hurt(new Game(table()));
    const out = unwrap(
      takeDamageResponse(g.state, GRIM, { feature: 'berserker:retaliation' }, supply()),
      'retaliate',
    );
    const taken = out.events.find((e) => e.type === 'reaction-taken');
    expect(taken?.type === 'reaction-taken' ? taken.against : null).toBe(THUG);
  });

  /** SRD: "**within 5 feet** of you". */
  it('refuses a creature further than five feet away', () => {
    const g = hurt(new Game(table(20)));
    const out = takeDamageResponse(g.state, GRIM, { feature: 'berserker:retaliation' }, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('out_of_range');
  });

  /**
   * The window is two facts already in state — `lastDamage` and the clock —
   * read by the same function *Hellish Rebuke*'s trigger reads. One rule, one
   * reading, a spell and a class feature.
   */
  it('refuses once the moment has passed', () => {
    const g = hurt(new Game(table()));
    g.push([{ type: 'time-advanced', seconds: 6, reason: 'a pause' }]);
    const out = takeDamageResponse(g.state, GRIM, { feature: 'berserker:retaliation' }, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('no_trigger');
  });

  it('refuses before anything has damaged the Barbarian', () => {
    const g = new Game(table());
    const out = takeDamageResponse(g.state, GRIM, { feature: 'berserker:retaliation' }, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('no_trigger');
  });

  /** A trap names no dealer, and there is nothing to swing at. */
  it('refuses damage that no creature dealt', () => {
    const g = new Game(table()).push(
      unwrap(resolveDamage(fold('seed', table()), GRIM, { amount: 9, source: 'a trap' }, supply()), 'd')
        .events,
    );
    const out = takeDamageResponse(g.state, GRIM, { feature: 'berserker:retaliation' }, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('no_trigger');
  });

  it('refuses with no Reaction left', () => {
    const g = hurt(new Game(table())).push([{ type: 'reaction-spent', id: GRIM }]);
    const out = takeDamageResponse(g.state, GRIM, { feature: 'berserker:retaliation' }, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('no_reaction');
  });
});

// — timing mistakes, made on purpose ——————————————————————————————————————————

describe('a Reaction taken at the wrong moment', () => {
  const rogueTable = () => new Game(duel(NYX, sheetFor(rogue(5), 'rogue 5')));

  /** Before the trigger. There is nothing to answer. */
  it('is refused before any damage has been rolled', () => {
    const g = rogueTable();
    const out = takeDamageReaction(g.state, NYX, { feature: 'rogue:uncanny-dodge' }, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('no_pending_damage');
  });

  /** After the outcome is settled. The blow has landed; halving is too late. */
  it('is refused once the damage has been dealt', () => {
    const g = rogueTable();
    swing(g, NYX);
    g.push(unwrap(settleDamage(g.state, supply()), 'settle').events);

    const late = takeDamageReaction(g.state, NYX, { feature: 'rogue:uncanny-dodge' }, supply());
    expect(isErr(late) ? late.code : 'ok').toBe('no_pending_damage');
  });

  /** Without a Reaction to spend — and the offer is withheld, not refused late. */
  it('is refused when the Reaction is gone between the offer and the answer', () => {
    const g = rogueTable();
    swing(g, NYX);
    // Something else took it in the meantime; the offer in state is stale and
    // the command checks the budget again rather than trusting it.
    g.push([{ type: 'reaction-spent', id: NYX }]);
    const out = takeDamageReaction(g.state, NYX, { feature: 'rogue:uncanny-dodge' }, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('no_reaction');
  });

  /** The wrong reactor. */
  it('is refused from somebody who was never offered it', () => {
    const g = rogueTable();
    swing(g, NYX);
    const out = takeDamageReaction(g.state, THUG, { feature: 'rogue:uncanny-dodge' }, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('not_offered');
  });

  /** The wrong feature, from the right reactor. */
  it('is refused for a feature the reactor was not offered', () => {
    const g = rogueTable();
    swing(g, NYX);
    const out = takeDamageReaction(g.state, NYX, { feature: 'monk:deflect-attacks' }, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('not_offered');
  });

  /** Twice, from the same reactor, on the same blow. */
  it('cannot reduce the same damage twice', () => {
    const g = rogueTable();
    swing(g, NYX);
    g.push(
      unwrap(takeDamageReaction(g.state, NYX, { feature: 'rogue:uncanny-dodge' }, supply()), 'once')
        .events,
    );
    const twice = takeDamageReaction(g.state, NYX, { feature: 'rogue:uncanny-dodge' }, supply());
    expect(isErr(twice) ? twice.code : 'ok').toBe('not_offered');
  });

  /** A window that has been answered and closed cannot be reopened. */
  it('cannot settle the same damage twice', () => {
    const g = rogueTable();
    swing(g, NYX);
    g.push(unwrap(settleDamage(g.state, supply()), 'settle').events);
    const again = settleDamage(g.state, supply());
    expect(isErr(again) ? again.code : 'ok').toBe('no_pending_damage');
  });

  /** A declined offer is spent: the Rogue cannot change their mind. */
  it('cannot take a Reaction after declining it', () => {
    const g = rogueTable();
    swing(g, NYX);
    g.push(unwrap(declineDamageReaction(g.state, NYX, {}), 'decline'));
    const late = takeDamageReaction(g.state, NYX, { feature: 'rogue:uncanny-dodge' }, supply());
    expect(isErr(late) ? late.code : 'ok').toBe('not_offered');
  });

  /** And a second swing may not be rolled into a window already holding one. */
  it('refuses a second attack while damage is held', () => {
    const g = rogueTable();
    swing(g, NYX);
    const again = resolveAttack(g.state, THUG, { target: NYX, weapon: 'longsword' }, supply());
    expect(isErr(again) ? again.code : 'ok').toBe('damage_pending');
  });

  /** A log that asserts a second held damage roll is corrupt, loudly. */
  it('refuses a log that opens two damage windows', () => {
    const g = rogueTable();
    swing(g, NYX);
    const held = g.state.pendingDamage!;
    expect(() => fold('seed', [...g.log, { type: 'damage-rolled', damage: held }])).toThrow();
  });

  /** And one that settles a window somebody still owes an answer to. */
  it('refuses a log that settles a window with an offer outstanding', () => {
    const g = rogueTable();
    swing(g, NYX);
    expect(() =>
      fold('seed', [...g.log, { type: 'damage-settled', target: NYX }]),
    ).toThrow();
  });

  /** And an answer from somebody who was never offered one. */
  it('refuses a log in which an unoffered creature answers', () => {
    const g = rogueTable();
    swing(g, NYX);
    expect(() =>
      fold('seed', [
        ...g.log,
        { type: 'damage-reaction-answered', reactor: THUG, took: false },
      ]),
    ).toThrow();
  });
});

describe('a mechanically real debt stops the game moving on', () => {
  it('refuses to advance the turn while damage is held', () => {
    const g = new Game(duel(NYX, sheetFor(rogue(5), 'rogue 5')));
    swing(g, NYX);
    const out = resolveTurn(g.state, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('damage_pending');

    g.push(unwrap(settleDamage(g.state, supply()), 'settle').events);
    expect(isErr(resolveTurn(g.state, supply()))).toBe(false);
  });

  it('refuses to advance the turn while a D20 Test is unsettled', () => {
    const g = new Game([
      added(BRAM, 'party', sheetFor(fighter(9), 'fighter 9')),
      pool(BRAM, 'fighter:indomitable', 'Indomitable', 1),
      { type: 'combat-started', combatants: [{ id: BRAM, initiative: 10, speed: 30 }] },
    ]);
    g.push(
      unwrap(
        resolveTest(g.state, BRAM, { kind: 'saving-throw', ability: 'dex', dc: 40 }, supply()),
        'save',
      ).events,
    );
    const out = resolveTurn(g.state, supply());
    expect(isErr(out) ? out.code : 'ok').toBe('test_pending');

    g.push(unwrap(settleTest(g.state), 'settle').events);
    expect(isErr(resolveTurn(g.state, supply()))).toBe(false);
  });

  /**
   * Casting into an unsettled window would change the world underneath an
   * outcome nobody has decided. `pendingAttack` is deliberately *not* in this
   * list, because SRD Divine Smite is cast into that window on purpose.
   */
  it('refuses a casting while damage is held', () => {
    const g = new Game([
      ...duel(NYX, sheetFor(rogue(5), 'rogue 5'), { combat: false }),
      added(ILVA, 'party', sheetFor(bard(5), 'bard 5')),
      {
        type: 'spellcasting-declared',
        id: ILVA,
        spellcasting: {
          classes: [
            {
              classId: 'bard',
              ability: 'cha',
              cantrips: ['vicious-mockery'],
              prepared: ['cure-wounds'],
              slotKind: 'spell',
            },
          ],
          granted: [],
        },
      },
      pool(ILVA, 'spell-slot:1', 'Level 1 slots', 4),
      at(ILVA, NYX, 10, 90),
      {
        type: 'combat-started',
        combatants: [
          { id: THUG, initiative: 20, speed: 30 },
          { id: NYX, initiative: 10, speed: 30 },
          { id: ILVA, initiative: 5, speed: 30 },
        ],
      },
    ]);
    swing(g, NYX);
    const cast = resolveSpell(
      g.state,
      ILVA,
      { spellId: 'cure-wounds', targets: [NYX], slotLevel: 1 },
      supply(),
    );
    expect(isErr(cast) ? cast.code : 'ok').toBe('damage_pending');
  });
});

// — retries ——————————————————————————————————————————————————————————————————

describe('a retried reaction changes nothing the first one did not', () => {
  /**
   * Reaction windows are the most retry-vulnerable thing in the engine: every
   * one of them is a second round trip, and a model-driven loop retries for
   * reasons that have nothing to do with the game. Each guard below comes
   * *before* the validation that would otherwise report the world its own
   * first run made.
   */
  const rogueTable = () => new Game(duel(NYX, sheetFor(rogue(5), 'rogue 5')));

  it('does not spend a second Reaction', () => {
    const g = rogueTable();
    swing(g, NYX);
    const first = unwrap(
      takeDamageReaction(g.state, NYX, { feature: 'rogue:uncanny-dodge', commandId: 'r1' }, supply()),
      'first',
    );
    g.push(first.events);

    const retry = unwrap(
      takeDamageReaction(g.state, NYX, { feature: 'rogue:uncanny-dodge', commandId: 'r1' }, supply()),
      'retry',
    );
    expect(retry.events).toEqual([]);
    expect(retry.duplicate).toBe(true);
    expect(g.state.pendingDamage?.reductions).toHaveLength(1);
  });

  it('does not apply the reduction twice', () => {
    const g = rogueTable();
    swing(g, NYX);
    g.push(
      unwrap(
        takeDamageReaction(
          g.state,
          NYX,
          { feature: 'rogue:uncanny-dodge', commandId: 'r1' },
          supply(),
        ),
        'first',
      ).events,
    );
    const before = g.state;
    const retry = unwrap(
      takeDamageReaction(g.state, NYX, { feature: 'rogue:uncanny-dodge', commandId: 'r1' }, supply()),
      'retry',
    );
    expect(fold('seed', [...g.log, ...retry.events])).toEqual(before);
  });

  it('does not settle the damage twice', () => {
    const g = rogueTable();
    swing(g, NYX);
    g.push(unwrap(settleDamage(g.state, supply(), { commandId: 's1' }), 'settle').events);
    const before = g.state;

    const retry = unwrap(settleDamage(g.state, supply(), { commandId: 's1' }), 'retry');
    expect(retry.events).toEqual([]);
    expect(retry.duplicate).toBe(true);
    expect(fold('seed', [...g.log, ...retry.events])).toEqual(before);
  });

  /**
   * The one that would be silently wrong. A retried *attack* must not open a
   * second window, and the duplicate check has to come before the
   * `damage_pending` guard — otherwise the retry reports a window its own
   * first run opened, which is the third time that trap has been sprung in
   * this repo.
   */
  it('does not open a second window when the attack is retried', () => {
    const g = rogueTable();
    const first = unwrap(
      resolveAttack(
        g.state,
        THUG,
        {
          target: NYX,
          weapon: 'longsword',
          attackBonuses: [{ source: 'forced', flat: 40 }],
          commandId: 'a1',
        },
        supply(),
      ),
      'first',
    );
    g.push(first.events);
    expect(g.state.pendingDamage?.offers).toHaveLength(1);

    const retry = unwrap(
      resolveAttack(
        g.state,
        THUG,
        {
          target: NYX,
          weapon: 'longsword',
          attackBonuses: [{ source: 'forced', flat: 40 }],
          commandId: 'a1',
        },
        supply(),
      ),
      'retry',
    );
    expect(retry.duplicate).toBe(true);
    expect(retry.events).toEqual([]);
    expect(g.state.pendingDamage?.offers).toHaveLength(1);
  });

  it('does not decline twice', () => {
    const g = rogueTable();
    swing(g, NYX);
    g.push(unwrap(declineDamageReaction(g.state, NYX, { commandId: 'd1' }), 'decline'));
    expect(unwrap(declineDamageReaction(g.state, NYX, { commandId: 'd1' }), 'retry')).toEqual([]);
  });

  it('does not push the same test twice', () => {
    const g = new Game([
      added(BRAM, 'party', sheetFor(fighter(9), 'fighter 9')),
      pool(BRAM, 'fighter:indomitable', 'Indomitable', 2),
    ]);
    g.push(
      unwrap(
        resolveTest(g.state, BRAM, { kind: 'saving-throw', ability: 'dex', dc: 40 }, supply()),
        'save',
      ).events,
    );
    g.push(
      unwrap(
        takeTestReaction(g.state, BRAM, { feature: 'fighter:indomitable', commandId: 'i1' }, supply()),
        'first',
      ).events,
    );
    const before = g.state;
    const retry = unwrap(
      takeTestReaction(g.state, BRAM, { feature: 'fighter:indomitable', commandId: 'i1' }, supply()),
      'retry',
    );
    expect(retry.events).toEqual([]);
    expect(fold('seed', [...g.log, ...retry.events])).toEqual(before);
    expect(g.left(BRAM, 'fighter:indomitable')).toBe(1);
  });

  it('does not swing twice on a retried Retaliation', () => {
    const table: GameEvent[] = [
      added(GRIM, 'party', sheetFor(barbarian(10), 'barbarian 10'), 100),
      added(THUG, 'thugs', plain()),
      kit(GRIM, ['greataxe']),
      { type: 'item-equipped', id: GRIM, item: 'greataxe' },
      ...scene,
      { type: 'creature-placed', id: GRIM, placement: { from: { landmark: 'the hall' }, feet: 0 } },
      at(THUG, GRIM, 5, 0),
      {
        type: 'combat-started',
        combatants: [
          { id: THUG, initiative: 20, speed: 30 },
          { id: GRIM, initiative: 10, speed: 30 },
        ],
      },
    ];
    const g = new Game(table).push(
      unwrap(
        resolveDamage(fold('seed', table), GRIM, { amount: 9, source: 'Longsword', by: THUG }, supply()),
        'damage',
      ).events,
    );
    g.push(
      unwrap(
        takeDamageResponse(
          g.state,
          GRIM,
          { feature: 'berserker:retaliation', weapon: 'greataxe', commandId: 'ret' },
          supply('swing'),
        ),
        'first',
      ).events,
    );
    const before = g.state;
    const retry = unwrap(
      takeDamageResponse(
        g.state,
        GRIM,
        { feature: 'berserker:retaliation', weapon: 'greataxe', commandId: 'ret' },
        supply('swing'),
      ),
      'retry',
    );
    expect(retry.events).toEqual([]);
    expect(fold('seed', [...g.log, ...retry.events])).toEqual(before);
  });

  /** Reusing an id for different work is refused rather than swallowed. */
  it('refuses a reaction command id reused for a different feature', () => {
    const g = new Game([
      ...duel(TAM, sheetFor(monk(13), 'monk 13')),
    ]);
    swing(g, TAM);
    g.push(
      unwrap(
        takeDamageReaction(g.state, TAM, { feature: 'monk:deflect-attacks', commandId: 'x' }, supply()),
        'first',
      ).events,
    );
    const reused = takeDamageReaction(
      g.state,
      TAM,
      { feature: 'rogue:uncanny-dodge', commandId: 'x' },
      supply(),
    );
    expect(isErr(reused) ? reused.code : 'ok').toBe('command_id_reused');
  });
});

// — replay ———————————————————————————————————————————————————————————————————

describe('a reaction window survives a reload', () => {
  /**
   * Any durable opportunity must reconstruct exactly from the event history —
   * which is the whole difference between this and the pending Concentration
   * save that had to be torn out of the engine.
   */
  const roundTrip = (log: readonly GameEvent[]): GameState =>
    fold('seed', JSON.parse(JSON.stringify(log)) as GameEvent[]);

  it('rebuilds the offers between the trigger and the reaction', () => {
    const g = new Game(duel(NYX, sheetFor(rogue(5), 'rogue 5')));
    swing(g, NYX);

    const reloaded = roundTrip(g.log);
    expect(reloaded).toStrictEqual(g.state);
    expect(reloaded.pendingDamage?.offers).toHaveLength(1);

    // And the Reaction can be taken against the reloaded state.
    const out = unwrap(
      takeDamageReaction(reloaded, NYX, { feature: 'rogue:uncanny-dodge' }, supply()),
      'dodge',
    );
    expect(out.reduction).toBeDefined();
  });

  it('rebuilds the reduction between the reaction and the settlement', () => {
    const g = new Game(duel(NYX, sheetFor(rogue(5), 'rogue 5')));
    swing(g, NYX);
    g.push(
      unwrap(takeDamageReaction(g.state, NYX, { feature: 'rogue:uncanny-dodge' }, supply()), 'dodge')
        .events,
    );

    const reloaded = roundTrip(g.log);
    expect(reloaded).toStrictEqual(g.state);
    expect(reloaded.pendingDamage?.reductions).toHaveLength(1);
    expect(unwrap(settleDamage(reloaded, supply()), 'settle').amount).toBe(
      unwrap(settleDamage(g.state, supply()), 'settle').amount,
    );
  });

  it('rebuilds a declined window between the decline and the settlement', () => {
    const g = new Game(duel(NYX, sheetFor(rogue(5), 'rogue 5')));
    swing(g, NYX);
    g.push(unwrap(declineDamageReaction(g.state, NYX, {}), 'decline'));
    expect(roundTrip(g.log)).toStrictEqual(g.state);
    expect(roundTrip(g.log).pendingDamage?.offers).toEqual([]);
  });

  it('rebuilds a held D20 Test, roll and all', () => {
    const g = new Game([
      added(BRAM, 'party', sheetFor(fighter(9), 'fighter 9')),
      pool(BRAM, 'fighter:indomitable', 'Indomitable', 1),
    ]);
    const rolled = unwrap(
      resolveTest(g.state, BRAM, { kind: 'saving-throw', ability: 'dex', dc: 40 }, supply()),
      'save',
    );
    g.push(rolled.events);
    const reloaded = roundTrip(g.log);
    expect(reloaded).toStrictEqual(g.state);
    expect(reloaded.pendingTest?.result.natural).toBe(rolled.test?.natural);
  });

  it('folds at every prefix of a whole reaction sequence', () => {
    const g = new Game(duel(NYX, sheetFor(rogue(5), 'rogue 5')));
    swing(g, NYX);
    g.push(
      unwrap(takeDamageReaction(g.state, NYX, { feature: 'rogue:uncanny-dodge' }, supply()), 'dodge')
        .events,
    );
    g.push(unwrap(settleDamage(g.state, supply()), 'settle').events);
    g.foldsAtEveryPrefix();
  });
});

// — the creature who walks out mid-window —————————————————————————————————————

describe('a creature leaving mid-window', () => {
  /**
   * A debt whose only settling command is addressed to somebody who has left
   * the game is a campaign that never continues. The engine settles what it
   * can and is honest about the rest — the same trade `settleHoldsInvolving`
   * already makes for a held attack whose damage is never rolled.
   */
  it('closes the window with the damage undealt when the target leaves', () => {
    const g = new Game(duel(NYX, sheetFor(rogue(5), 'rogue 5')));
    swing(g, NYX);
    const before = g.hp(NYX);

    g.push(unwrap(removeCreatureEverywhere(g.state, NYX), 'remove'));
    expect(g.state.pendingDamage).toBeNull();
    expect(g.state.creatures[NYX]).toBeUndefined();
    // The blow is in the log and was never dealt; the log says exactly that.
    expect(before).toBe(80);
  });

  /** A departing bystander leaves the blow to land on whoever it was aimed at. */
  it('still lands the blow when a third-party reactor leaves', () => {
    const g = new Game([
      ...duel(NYX, plain(), { combat: false }),
      added(ILVA, 'party', sheetFor(bard(5), 'bard 5')),
      pool(ILVA, 'bardic-inspiration', 'Bardic Inspiration', 3),
      at(ILVA, THUG, 30, 90),
      sees(ILVA, THUG),
      {
        type: 'combat-started',
        combatants: [
          { id: THUG, initiative: 20, speed: 30 },
          { id: NYX, initiative: 10, speed: 30 },
          { id: ILVA, initiative: 5, speed: 30 },
        ],
      },
    ]);
    swing(g, NYX);
    g.push(unwrap(removeCreatureEverywhere(g.state, ILVA), 'remove'));

    // The window is still open, and settling records the departed Bard's
    // offer as passed rather than wedging on it.
    expect(g.state.pendingDamage?.offers).toHaveLength(1);
    const settled = unwrap(settleDamage(g.state, supply()), 'settle');
    g.push(settled.events);
    expect(settled.amount).toBeGreaterThan(0);
    expect(g.state.pendingDamage).toBeNull();
  });

  it('closes a held D20 Test when its roller leaves', () => {
    const g = new Game([
      added(BRAM, 'party', sheetFor(fighter(9), 'fighter 9')),
      pool(BRAM, 'fighter:indomitable', 'Indomitable', 1),
    ]);
    g.push(
      unwrap(
        resolveTest(g.state, BRAM, { kind: 'saving-throw', ability: 'dex', dc: 40 }, supply()),
        'save',
      ).events,
    );
    g.push(unwrap(removeCreatureEverywhere(g.state, BRAM), 'remove'));
    expect(g.state.pendingTest).toBeNull();
  });
});

// — Maestro's half ———————————————————————————————————————————————————————————

describe('reactionOpportunities', () => {
  /**
   * The engine could always *refuse* a Reaction taken at the wrong moment and
   * could never say a moment was open. A model that has to guess will either
   * never cast a Shield or will try constantly and be refused.
   */
  it('reports the offers on a held damage roll, with what each would cost', () => {
    const g = new Game(duel(NYX, sheetFor(rogue(5), 'rogue 5')));
    swing(g, NYX);
    expect(reactionOpportunities(g.state)).toEqual([
      {
        window: 'damage-rolled',
        reactor: NYX,
        id: 'rogue:uncanny-dodge',
        name: 'Uncanny Dodge',
        kind: 'feature',
        costsReaction: true,
        pool: null,
        against: THUG,
      },
    ]);
  });

  it('reports nothing when no window is open', () => {
    const g = new Game(duel(NYX, sheetFor(rogue(5), 'rogue 5')));
    expect(reactionOpportunities(g.state)).toEqual([]);
  });

  it('reports a feature and a spell at the settled damage window together', () => {
    const table: GameEvent[] = [
      added(GRIM, 'party', sheetFor(barbarian(10), 'barbarian 10'), 100),
      added(THUG, 'thugs', plain()),
      ...scene,
      { type: 'creature-placed', id: GRIM, placement: { from: { landmark: 'the hall' }, feet: 0 } },
      at(THUG, GRIM, 5, 0),
      {
        type: 'spellcasting-declared',
        id: GRIM,
        spellcasting: {
          classes: [
            {
              classId: 'warlock',
              ability: 'cha',
              cantrips: [],
              prepared: ['hellish-rebuke'],
              slotKind: 'pact',
            },
          ],
          granted: [],
        },
      },
      {
        type: 'combat-started',
        combatants: [
          { id: THUG, initiative: 20, speed: 30 },
          { id: GRIM, initiative: 10, speed: 30 },
        ],
      },
    ];
    const g = new Game(table).push(
      unwrap(
        resolveDamage(fold('seed', table), GRIM, { amount: 9, source: 'Longsword', by: THUG }, supply()),
        'damage',
      ).events,
    );

    const found = reactionOpportunities(g.state);
    expect(found.map((o) => `${o.kind}:${o.id}`).sort()).toEqual([
      'feature:berserker:retaliation',
      'spell:hellish-rebuke',
    ]);
    // Both answer the same instant, and the engine reads it once.
    expect(new Set(found.map((o) => o.window))).toEqual(new Set(['damaged-by-creature']));
    expect(new Set(found.map((o) => o.against))).toEqual(new Set([THUG]));
  });

  /** A creature with no Reaction left is not offered one. */
  it('reports nothing for a creature whose Reaction is spent', () => {
    const g = new Game(duel(NYX, sheetFor(rogue(5), 'rogue 5')));
    swing(g, NYX);
    g.push([{ type: 'reaction-spent', id: NYX }]);
    // The offer is still in the record — the engine does not rewrite history —
    // but the discovery query reads the budget as it stands.
    expect(reactionOpportunities(g.state)).toEqual([]);
  });
});

// — the windows in sequence ——————————————————————————————————————————————————

describe('the existing Reaction spells still work, and compose with the new window', () => {
  /**
   * Two windows on one blow, one after the other and never at once:
   *
   * 1. `hit-by-attack` — the hit is known and the damage is unrolled. *Shield*
   *    is cast into it and the attack is re-measured.
   * 2. `damage-rolled` — the damage exists and has not landed. Uncanny Dodge
   *    answers that one.
   *
   * A Rogue who is also a caster would see both, in that order, and the second
   * only ever opens once the first has closed. That is what makes these
   * *stages* rather than one vague "a reaction may happen here".
   */
  const wizardly = (): GameEvent[] => [
    ...duel(NYX, sheetFor(rogue(5), 'rogue 5'), { combat: false }),
    {
      type: 'spellcasting-declared',
      id: NYX,
      spellcasting: {
        classes: [
          {
            classId: 'wizard',
            ability: 'int',
            cantrips: [],
            prepared: ['shield'],
            slotKind: 'spell',
          },
        ],
        granted: [],
      },
    },
    pool(NYX, 'spell-slot:1', 'Level 1 slots', 4),
    {
      type: 'combat-started',
      combatants: [
        { id: THUG, initiative: 20, speed: 30 },
        { id: NYX, initiative: 10, speed: 30 },
      ],
    },
  ];

  /** The Shield window, discovered rather than guessed at. */
  it('reports a Shield as available while the attack is held, and nothing before', () => {
    const g = new Game(wizardly());
    expect(reactionOpportunities(g.state)).toEqual([]);

    const out = unwrap(
      resolveAttack(
        g.state,
        THUG,
        {
          target: NYX,
          weapon: 'longsword',
          hold: true,
          attackBonuses: [{ source: 'forced', flat: 40 }],
        },
        supply(),
      ),
      'attack',
    );
    g.push(out.events);
    expect(g.state.pendingAttack).not.toBeNull();
    // No damage window yet: nothing has been rolled to answer.
    expect(g.state.pendingDamage).toBeNull();

    expect(reactionOpportunities(g.state)).toEqual([
      {
        window: 'hit-by-attack',
        reactor: NYX,
        id: 'shield',
        name: 'Shield',
        kind: 'spell',
        costsReaction: true,
        pool: null,
        against: THUG,
      },
    ]);
  });

  /**
   * And the second window opens only once the first has closed. The Rogue
   * declines the Shield (or has no slot), the damage is rolled, and *then*
   * Uncanny Dodge is offered.
   */
  it('opens the damage window only after the held attack settles', () => {
    const g = new Game(wizardly());
    g.push(
      unwrap(
        resolveAttack(
          g.state,
          THUG,
          {
            target: NYX,
            weapon: 'longsword',
            hold: true,
            attackBonuses: [{ source: 'forced', flat: 40 }],
          },
          supply(),
        ),
        'attack',
      ).events,
    );

    const settled = unwrap(resolveAttackDamage(g.state, THUG, {}, supply('dmg')), 'damage');
    g.push(settled.events);

    expect(g.state.pendingAttack).toBeNull();
    expect(g.state.pendingDamage?.target).toBe(NYX);
    expect(settled.reactions?.map((o) => o.feature)).toEqual(['rogue:uncanny-dodge']);
    // Still nothing dealt.
    expect(g.hp(NYX)).toBe(80);
  });

  /**
   * SRD *Shield*: "+5 bonus to AC, **including against the triggering
   * attack**." When it turns the hit into a miss there is no damage at all —
   * so no damage window opens either, which is the right answer and the one a
   * stage-less design would get wrong.
   */
  it('opens no damage window at all when Shield turns the hit aside', () => {
    const g = new Game(wizardly());
    // A hit that clears the Armour Class by exactly nothing, so +5 undoes it.
    // Scouted with the same seed rather than hoped for: the roll is identical
    // and only the bonus that lands it on the number changes.
    const ac = armorClassOf(g.state, NYX);
    const scouted = unwrap(
      resolveAttack(g.state, THUG, { target: NYX, weapon: 'longsword' }, supply('graze')),
      'scout',
    );
    const grazing = ac - (scouted.attack?.total ?? 0);

    g.push(
      unwrap(
        resolveAttack(
          g.state,
          THUG,
          {
            target: NYX,
            weapon: 'longsword',
            hold: true,
            attackBonuses: [{ source: 'forced', flat: grazing }],
          },
          supply('graze'),
        ),
        'attack',
      ).events,
    );
    expect(g.state.pendingAttack?.total).toBe(ac);

    const shielded = unwrap(
      resolveSpell(g.state, NYX, { spellId: 'shield', targets: [NYX], slotLevel: 1 }, supply()),
      'shield',
    );
    g.push(shielded.events);

    // The hold closed with no damage, and nothing is waiting to be reduced.
    expect(g.state.pendingAttack).toBeNull();
    expect(g.state.pendingDamage).toBeNull();
    expect(g.hp(NYX)).toBe(80);
  });

  /**
   * *Hellish Rebuke* and Retaliation answer the same instant under the same
   * rule, and `damageWindowOpen` is the one function that decides it. The
   * clock closing the window has to close it for both, or the vocabulary is
   * shared in name only.
   */
  it('closes the settled window for a spell and a feature at the same moment', () => {
    const table: GameEvent[] = [
      added(GRIM, 'party', sheetFor(barbarian(10), 'barbarian 10'), 100),
      added(THUG, 'thugs', plain()),
      ...scene,
      { type: 'creature-placed', id: GRIM, placement: { from: { landmark: 'the hall' }, feet: 0 } },
      at(THUG, GRIM, 5, 0),
      sees(GRIM, THUG),
      {
        type: 'spellcasting-declared',
        id: GRIM,
        spellcasting: {
          classes: [
            {
              classId: 'warlock',
              ability: 'cha',
              cantrips: [],
              prepared: ['hellish-rebuke'],
              slotKind: 'pact',
            },
          ],
          granted: [],
        },
      },
      pool(GRIM, 'pact-slot:1', 'Pact slots', 2),
      {
        type: 'combat-started',
        combatants: [
          { id: THUG, initiative: 20, speed: 30 },
          { id: GRIM, initiative: 10, speed: 30 },
        ],
      },
    ];
    const g = new Game(table).push(
      unwrap(
        resolveDamage(fold('seed', table), GRIM, { amount: 9, source: 'Longsword', by: THUG }, supply()),
        'damage',
      ).events,
    );

    // Both open.
    expect(reactionOpportunities(g.state).map((o) => o.id).sort()).toEqual([
      'berserker:retaliation',
      'hellish-rebuke',
    ]);

    // The clock moves; both shut.
    g.push([{ type: 'time-advanced', seconds: 6, reason: 'a pause' }]);
    expect(reactionOpportunities(g.state)).toEqual([]);

    const feature = takeDamageResponse(g.state, GRIM, { feature: 'berserker:retaliation' }, supply());
    const spell = resolveSpell(
      g.state,
      GRIM,
      { spellId: 'hellish-rebuke', targets: [THUG], slotKind: 'pact', slotLevel: 1 },
      supply(),
    );
    expect(isErr(feature) ? feature.code : 'ok').toBe('no_trigger');
    expect(isErr(spell) ? spell.code : 'ok').toBe('no_trigger');
  });
});
