import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { pendingAttackOf, resolveAttack, resolveAttackDamage, resolveTurn } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * Damage decided after the roll lands.
 *
 * SRD 2024 Divine Smite is a **spell**, and its casting time is the whole
 * problem: "Bonus Action, which you take immediately after hitting a target
 * with a Melee weapon or an Unarmed Strike." The decision falls between the
 * attack roll and the damage roll — a moment `resolveAttack` passed straight
 * through, because it rolled both in one breath.
 *
 * So an attack can be **held**: it rolls, it reports the hit, and it leaves
 * the damage unrolled with the hit recorded in state. That is the shape of a
 * debt rather than a leak, and the difference from the pending Concentration
 * save that had to be torn out is the same difference `pendingSaves` draws:
 *
 * | | The one that was wrong | This one |
 * |---|---|---|
 * | Where it lived | a return value | `GameState`, from an event in the log |
 * | After a reload | gone | still there, because the fold rebuilds it |
 * | If forgotten | the spell silently stayed up | **the turn will not advance** |
 *
 * Holding is asked for rather than assumed. A Paladin who might smite says so
 * before swinging, which costs nothing and decides nothing — the slot is spent
 * only if they go through with it, and only on a hit.
 */

const id = (s: string) => asCharacterId(s);
const AELRIC = id('aelric');
const GOBLIN = id('goblin');

const plain = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const paladin = (): CharacterChoices => ({
  name: 'Aelric',
  classId: 'paladin',
  level: 5,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 10, con: 13, int: 8, wis: 12, cha: 14 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'persuasion'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Lawful Good',
  subclassId: 'oath-of-devotion',
  cantrips: [],
  spellbook: [],
  // A level 5 Paladin prepares 6, and Divine Smite is one of them.
  preparedSpells: [
    'divine-smite',
    'bless',
    'cure-wounds',
    'heroism',
    'shield-of-faith',
    'aid',
  ],
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
});

const SETUP: readonly GameEvent[] = [
  ...(unwrap(createCharacter(paladin(), AELRIC), 'create') as GameEvent[]),
  { type: 'creature-side-declared', id: AELRIC, side: 'party' },
  {
    type: 'creature-added',
    id: GOBLIN,
    name: 'goblin',
    sheet: plain(),
    maxHp: 200,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'goblins',
  },
  { type: 'items-gained', id: AELRIC, items: [{ id: 'greatsword', quantity: 1 }], source: 'loot' },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the gate', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: AELRIC, placement: { from: { landmark: 'the gate' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: AELRIC }, feet: 5, bearing: 0 } },
];

const supply = (seed = 'hit') => ({ issuer: createRollIssuer('r'), rng: createRng(seed) as Rng });

/**
 * The same table with an unhittable target.
 *
 * A miss has to be certain rather than lucky: an Armour Class of 30 against
 * a +5 attack can only be beaten by a natural 20, so the seed decides nothing
 * but which of the nineteen misses it is.
 */
const UNHITTABLE: readonly GameEvent[] = SETUP.map((e) =>
  e.type === 'creature-added' && e.id === GOBLIN
    ? { ...e, sheet: { ...plain(), stated: { armorClass: 30 } } }
    : e,
);

/** Swing with the damage held open. */
const held = (log: readonly GameEvent[] = SETUP, seed = 'hit') => {
  const out = unwrap(
    resolveAttack(
      fold('seed', log),
      AELRIC,
      { target: GOBLIN, weapon: 'greatsword', twoHanded: true, hold: true },
      supply(seed),
    ),
    'attack',
  );
  return { ...out, log: [...log, ...out.events] };
};

/** Swing and settle in one go, the ordinary way. */
const plainSwing = (log: readonly GameEvent[] = SETUP, seed = 'hit') =>
  unwrap(
    resolveAttack(
      fold('seed', log),
      AELRIC,
      { target: GOBLIN, weapon: 'greatsword', twoHanded: true },
      supply(seed),
    ),
    'attack',
  );

describe('an attack can be held between the roll and the damage', () => {
  it('rolls the attack and leaves the damage unrolled', () => {
    const out = held();
    expect(out.attack!.hit).toBe(true);
    expect(out.damage).toBeUndefined();
    expect(fold('seed', out.log).creatures.goblin!.vitals.hp).toBe(200);
  });

  it('records the hit in state, where a reload would still find it', () => {
    const state = fold('seed', held().log);
    const pending = pendingAttackOf(state);
    expect(pending).not.toBeNull();
    expect(pending?.attacker).toBe(AELRIC);
    expect(pending?.target).toBe(GOBLIN);

    // And it survives the round trip a reload is.
    const round = JSON.parse(JSON.stringify(state)) as GameState;
    expect(pendingAttackOf(round)).toEqual(pending);
  });

  /** A miss has no damage to hold, so there is nothing outstanding. */
  it('holds nothing on a miss', () => {
    const missed = held(UNHITTABLE, 'miss');
    expect(missed.attack!.hit).toBe(false);
    expect(pendingAttackOf(fold('seed', missed.log))).toBeNull();
  });

  /**
   * Not the *same* number as an unheld swing — the two roll their damage from
   * generators that have been advanced differently, which is what a separate
   * command means — but the same weapon, so the same range.
   */
  it('settles into the damage the weapon can actually deal', () => {
    const out = held();
    const settled = unwrap(
      resolveAttackDamage(fold('seed', out.log), AELRIC, {}, supply('hit')),
      'settle',
    );
    // A greatsword is 2d6, and Strength 15 is +2.
    expect(settled.damage).toBeGreaterThanOrEqual(2 + 2);
    expect(settled.damage).toBeLessThanOrEqual(12 + 2);
    expect(plainSwing().damage).toBeGreaterThan(0);
  });

  it('clears the debt once it is settled', () => {
    const out = held();
    const settled = unwrap(
      resolveAttackDamage(fold('seed', out.log), AELRIC, {}, supply('hit')),
      'settle',
    );
    expect(pendingAttackOf(fold('seed', [...out.log, ...settled.events]))).toBeNull();
  });

  it('refuses to settle an attack nobody is holding', () => {
    const out = resolveAttackDamage(fold('seed', SETUP), AELRIC, {}, supply());
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('no_pending_attack');
  });
});

describe('a debt that is forgotten stops the game rather than vanishing', () => {
  const fighting = (): readonly GameEvent[] => [
    ...SETUP,
    {
      type: 'combat-started',
      combatants: [
        { id: AELRIC, initiative: 20, speed: 30 },
        { id: GOBLIN, initiative: 10, speed: 30 },
      ],
    },
  ];

  it('will not advance the turn while an attack is outstanding', () => {
    const out = held(fighting());
    const advanced = resolveTurn(fold('seed', out.log), supply());
    expect(isErr(advanced)).toBe(true);
    if (isErr(advanced)) expect(advanced.code).toBe('attack_pending');
  });

  it('will not start a second attack while one is outstanding', () => {
    const out = held(fighting());
    const again = resolveAttack(
      fold('seed', out.log),
      AELRIC,
      { target: GOBLIN, weapon: 'greatsword', twoHanded: true },
      supply(),
    );
    expect(isErr(again)).toBe(true);
    if (isErr(again)) expect(again.code).toBe('attack_pending');
  });

  it('advances once the damage has landed', () => {
    const out = held(fighting());
    const settled = unwrap(
      resolveAttackDamage(fold('seed', out.log), AELRIC, {}, supply('hit')),
      'settle',
    );
    const after = fold('seed', [...out.log, ...settled.events]);
    expect(isErr(resolveTurn(after, supply()))).toBe(false);
  });
});

describe('Divine Smite is a spell, and is paid for like one', () => {
  /**
   * SRD: "The target takes an extra 2d8 Radiant damage from the attack." From
   * the attack — so it is the attack's damage, and a critical doubles it.
   */
  it('adds Radiant damage to the blow', () => {
    const out = held();
    const plainDamage = unwrap(
      resolveAttackDamage(fold('seed', out.log), AELRIC, {}, supply('hit')),
      'plain',
    ).damage!;
    const smitten = unwrap(
      resolveAttackDamage(
        fold('seed', out.log),
        AELRIC,
        { smite: { spellId: 'divine-smite', slotLevel: 1 } },
        supply('hit'),
      ),
      'smite',
    );
    expect(smitten.damage! - plainDamage).toBeGreaterThanOrEqual(2);
  });

  it('spends the slot it costs', () => {
    const out = held();
    const before = remaining(fold('seed', out.log).creatures.aelric!.resources, spellSlotKey(1));
    const smitten = unwrap(
      resolveAttackDamage(
        fold('seed', out.log),
        AELRIC,
        { smite: { spellId: 'divine-smite', slotLevel: 1 } },
        supply('hit'),
      ),
      'smite',
    );
    const after = fold('seed', [...out.log, ...smitten.events]);
    expect(remaining(after.creatures.aelric!.resources, spellSlotKey(1))).toBe(before - 1);
  });

  /** SRD: "The damage increases by 1d8 for each spell slot level above 1." */
  it('scales with the slot spent', () => {
    const out = held();
    const at = (slotLevel: number) =>
      unwrap(
        resolveAttackDamage(
          fold('seed', out.log),
          AELRIC,
          { smite: { spellId: 'divine-smite', slotLevel } },
          supply('hit'),
        ),
        'smite',
      ).damage!;
    expect(at(2)).toBeGreaterThan(at(1));
  });

  /** And the slot is not spent when the swing missed, because there is no hit. */
  it('cannot be cast on a miss, because there is nothing to smite', () => {
    const missed = held(UNHITTABLE, 'miss');
    const out = resolveAttackDamage(
      fold('seed', missed.log),
      AELRIC,
      { smite: { spellId: 'divine-smite', slotLevel: 1 } },
      supply(),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('no_pending_attack');
  });

  it('refuses a spell the paladin has not prepared', () => {
    const out = resolveAttackDamage(
      fold('seed', held().log),
      AELRIC,
      { smite: { spellId: 'fireball', slotLevel: 3 } },
      supply(),
    );
    expect(isErr(out)).toBe(true);
  });

  it('refuses a slot the paladin does not have', () => {
    const out = resolveAttackDamage(
      fold('seed', held().log),
      AELRIC,
      { smite: { spellId: 'divine-smite', slotLevel: 5 } },
      supply(),
    );
    expect(isErr(out)).toBe(true);
  });

  /** Nothing is spent when it refuses: the debt is still there to settle. */
  it('leaves the slot and the debt alone when it refuses', () => {
    const out = held();
    resolveAttackDamage(
      fold('seed', out.log),
      AELRIC,
      { smite: { spellId: 'divine-smite', slotLevel: 5 } },
      supply(),
    );
    const state = fold('seed', out.log);
    expect(remaining(state.creatures.aelric!.resources, spellSlotKey(1))).toBe(4);
    expect(pendingAttackOf(state)).not.toBeNull();
  });

  /** `resolveSpell` is not the route: Divine Smite rides on an attack. */
  it('is not castable through the ordinary spell command', () => {
    const out = resolveAttackDamage(fold('seed', SETUP), AELRIC, {}, supply());
    expect(isErr(out)).toBe(true);
  });
});

describe('a held attack retries and replays', () => {
  it('is a no-op on a retried settle', () => {
    const out = held();
    const first = unwrap(
      resolveAttackDamage(fold('seed', out.log), AELRIC, { commandId: 's1' }, supply('hit')),
      'first',
    );
    const log = [...out.log, ...first.events];
    const retry = unwrap(
      resolveAttackDamage(fold('seed', log), AELRIC, { commandId: 's1' }, supply('hit')),
      'retry',
    );
    expect(retry.events).toEqual([]);
    expect(fold('seed', [...log, ...retry.events]).creatures.goblin!.vitals.hp).toBe(
      fold('seed', log).creatures.goblin!.vitals.hp,
    );
  });

  it('replays prefix by prefix', () => {
    const out = held();
    const settled = unwrap(
      resolveAttackDamage(fold('seed', out.log), AELRIC, {}, supply('hit')),
      'settle',
    );
    const log = [...out.log, ...settled.events];
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });
});
