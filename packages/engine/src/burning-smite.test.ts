import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import type { Rng, RngState } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import {
  advanceTime,
  endCombat,
  resolveAttack,
  resolveAttackDamage,
  resolveTurn,
} from './commands.js';

/**
 * A smite that keeps burning — SRD Searing Smite.
 *
 * > _Level 1 Evocation (Paladin)._ **Casting Time:** Bonus Action, which you
 * > take immediately after hitting a target with a Melee weapon or an Unarmed
 * > Strike. **Range:** Self. **Duration:** 1 minute.
 * > "As you hit the target, it takes an extra 1d6 Fire damage from the attack.
 * > At the start of each of its turns until the spell ends, the target takes
 * > 1d6 Fire damage and then makes a Constitution saving throw. On a failed
 * > save, the spell continues. On a successful save, the spell ends."
 * > _Using a Higher-Level Spell Slot._ "All the damage increases by 1d6 for
 * > each spell slot level above 1."
 *
 * Divine Smite's sibling, and the same `attack-damage` effect on the hit. What
 * Divine Smite does not print is the minute afterwards, and that minute is two
 * things this engine had separately and had never put together: a **casting**
 * that goes on running after the blow, and a **repeat save** that deals damage
 * before it is rolled and ends the casting on a success.
 *
 * So the casting a hit makes now takes the definition's own duration — an
 * ongoing record and a timer, where the spell prints one — and the timer
 * carries the hook. A boundary raises it from the casting exactly as it raises
 * one from a condition; the payout goes through the same damage funnel every
 * other spell's does, so defences, Concentration and the log's dice all apply;
 * and a success ends the casting, which takes the burning with it.
 *
 * Divine Smite is Instantaneous and must stay recordless, which is asserted
 * here rather than assumed.
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
  // A level 5 Paladin prepares 6, and both smites are among them.
  preparedSpells: [
    'divine-smite',
    'searing-smite',
    'bless',
    'cure-wounds',
    'heroism',
    'shield-of-faith',
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
  ...(unwrap(createCharacter(SRD_CONTENT, paladin(), AELRIC), 'create') as GameEvent[]),
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
  {
    type: 'creature-placed',
    id: GOBLIN,
    placement: { from: { creature: AELRIC }, feet: 5, bearing: 0 },
  },
  {
    type: 'combat-started',
    combatants: [
      { id: AELRIC, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
    ],
  },
];

/**
 * A chosen face on every d20 and the maximum on everything else.
 *
 * The saving throw is the only d20 in any of this, so one number decides
 * whether the spell continues — and every Fire die comes up 6, which is what
 * makes "1d6 or 2d6" a number the SRD sentence predicts rather than a sample.
 */
const scripted = (d20: number): Rng => ({
  int: (sides: number) => (sides === 20 ? d20 : sides),
  snapshot: (): RngState => [0, 0, 0, 0],
});

const supply = (d20 = 10) => ({
  issuer: createRollIssuer('r'),
  rng: scripted(d20) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>): T => unwrap(result, 'the smite');

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

/** Swing with the damage held, then settle it with the named smite. */
const smote = (
  spellId: string,
  slotLevel = 1,
  log: readonly GameEvent[] = SETUP,
): readonly GameEvent[] => {
  const hit = must(
    resolveAttack(
      state(log),
      AELRIC,
      { target: GOBLIN, weapon: 'greatsword', twoHanded: true, hold: true },
      supply(),
    ),
  );
  const swung = [...log, ...hit.events];
  const settled = must(
    resolveAttackDamage(state(swung), AELRIC, { smite: { spellId, slotLevel } }, supply()),
  );
  return [...swung, ...settled.events];
};

/** Advance one turn, rolling whatever the boundary owes. */
const turn = (log: readonly GameEvent[], d20 = 10): readonly GameEvent[] => [
  ...log,
  ...must(resolveTurn(state(log), supply(d20))).events,
];

const fireDealt = (events: readonly GameEvent[]): readonly number[] =>
  events.flatMap((event) =>
    event.type === 'damage-taken' && event.id === GOBLIN && event.source?.includes('Searing Smite')
      ? [event.amount]
      : [],
  );

const savesRolled = (events: readonly GameEvent[]): readonly GameEvent[] =>
  events.filter((event) => event.type === 'effect-save-resolved');

describe('the definition says the spell keeps burning', () => {
  const searing = () => SPELL_DEFINITIONS.find((one) => one.id === 'searing-smite');

  it('hangs the repeat save on the hit it is cast on', () => {
    expect(searing()?.effects[0]).toMatchObject({
      kind: 'attack-damage',
      damage: { dice: '1d6', perSlotLevelAbove: '1d6' },
      damageType: 'fire',
      repeats: {
        at: 'start-of-turn',
        ability: 'con',
        onSuccess: 'end-casting',
        beforeTheSave: {
          damage: { dice: '1d6', perSlotLevelAbove: '1d6' },
          damageType: 'fire',
        },
      },
    });
  });

  it('leaves nothing for the table to adjudicate', () => {
    expect(searing()?.unmodelled).toBeUndefined();
  });
});

describe('a smite with a duration leaves a casting running', () => {
  it('records the casting and hangs its timer', () => {
    const after = state(smote('searing-smite'));
    const running = Object.values(after.ongoing);
    expect(running).toHaveLength(1);
    expect(running[0]).toMatchObject({ spellId: 'searing-smite', caster: AELRIC, level: 1 });
    expect(Object.keys(after.timers)).toHaveLength(1);
  });

  /**
   * SRD Divine Smite is Instantaneous: the damage is the whole spell, and a
   * record for it would be a spell that never ends.
   */
  it('leaves Divine Smite recordless, because it is Instantaneous', () => {
    const after = state(smote('divine-smite'));
    expect(Object.keys(after.ongoing)).toHaveLength(0);
    expect(Object.keys(after.timers)).toHaveLength(0);
  });

  it('deals the extra die on the hit itself', () => {
    const plainHit = must(
      resolveAttack(
        state(SETUP),
        AELRIC,
        { target: GOBLIN, weapon: 'greatsword', twoHanded: true },
        supply(),
      ),
    ).damage!;
    const hurt = 200 - state(smote('searing-smite')).creatures.goblin!.vitals.hp;
    // Every die is maximal, so the whole of the difference is the 1d6.
    expect(hurt - plainHit).toBe(6);
  });
});

describe('the burning is collected at the start of the target’s turns', () => {
  /** A 1 on the d20 against a Paladin's save DC: the spell continues. */
  const failing = 1;
  /** A 20: the target shakes it off. */
  const passing = 20;

  it('deals the fire and then rolls the save', () => {
    const burning = smote('searing-smite');
    const advanced = must(resolveTurn(state(burning), supply(failing)));
    const dealt = advanced.events.findIndex(
      (event) => event.type === 'damage-taken' && event.id === GOBLIN,
    );
    const saved = advanced.events.findIndex((event) => event.type === 'effect-save-resolved');
    expect(dealt).toBeGreaterThanOrEqual(0);
    expect(saved).toBeGreaterThan(dealt);
    expect(fireDealt(advanced.events)).toEqual([6]);
    expect(advanced.saves[0]?.ability).toBe('con');
  });

  it('keeps burning through a failed save, and burns again next turn', () => {
    const burning = turn(smote('searing-smite'), failing);
    expect(Object.keys(state(burning).ongoing)).toHaveLength(1);

    // Round the order: the Paladin's turn, then the goblin's again.
    const second = turn(turn(burning, failing), failing);
    expect(fireDealt(second.slice(burning.length))).toEqual([6]);
  });

  it('ends the casting and the burning on a successful save', () => {
    const burning = turn(smote('searing-smite'), passing);
    const after = state(burning);
    expect(Object.keys(after.ongoing)).toHaveLength(0);
    expect(Object.keys(after.timers)).toHaveLength(0);

    // And nothing is owed at any later boundary.
    const later = turn(turn(burning, passing), passing);
    expect(fireDealt(later.slice(burning.length))).toEqual([]);
    expect(savesRolled(later.slice(burning.length))).toEqual([]);
  });

  /** "All the damage increases by 1d6 for each spell slot level above 1." */
  it('scales the burning with the slot it was cast at', () => {
    const burning = smote('searing-smite', 2);
    const advanced = must(resolveTurn(state(burning), supply(failing)));
    expect(fireDealt(advanced.events)).toEqual([12]);
  });

  /**
   * The minute is the casting's, and the burning goes with it.
   *
   * Out of the fight and onto the clock, because inside a fight the clock is
   * the turn order's — `advanceTime` refuses a span while one is running, and
   * what this is about is the deadline rather than the boundary.
   */
  it('stops when the spell’s own minute runs out', () => {
    const burning = smote('searing-smite');
    const quiet = [
      ...burning,
      ...must(endCombat(state(burning), { kind: 'surrender', side: 'goblins' })),
    ];
    const later = [...quiet, ...must(advanceTime(state(quiet), 60, 'the fight moves on'))];
    expect(Object.keys(state(later).ongoing)).toHaveLength(0);
    expect(Object.keys(state(later).timers)).toHaveLength(0);
  });
});
