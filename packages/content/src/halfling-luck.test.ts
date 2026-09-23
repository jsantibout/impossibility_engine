import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import {
  createCharacter,
  createRng,
  createRollIssuer,
  fold,
  resolveAttack,
  resolveTurn,
  rollAbilityCheck,
  rollInitiativeFor,
  rollSavingThrow,
  sheetAsItStands,
  type CharacterChoices,
  type CharacterSheet,
  type GameEvent,
  type GameState,
  type Rng,
  type RngState,
} from '@ie/engine';
import { SRD_CONTENT } from './index.js';

/**
 * **SRD Luck, and the two things it is not.**
 *
 * > When you roll a 1 on the d20 of a D20 Test, you can reroll the die, and
 * > you must use the new roll.
 *
 * It is not a `RollModifier`: that union is Advantage and Disadvantage,
 * weighed by `combineRollModes` before a die is thrown, and this is read after
 * one lands and replaces a result rather than changing how it was reached.
 *
 * It is not the reroll the engine already had either. `rerollTest` is
 * Indomitable's, offered at a named window and paid for with a Reaction; this
 * one costs nothing, is offered by nobody, and fires on the face rather than
 * on the outcome.
 *
 * So it lives in the pipeline, reached through the sheet — which is what this
 * file pins, on all three families and in the log.
 */

const id = (s: string) => asCharacterId(s);
const PIP = id('pip');
const BREN = id('bren');
const GOBLIN = id('goblin');

const choices = (speciesId: string, who: string): CharacterChoices => ({
  name: who,
  classId: 'fighter',
  level: 5,
  speciesId,
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  subclassId: 'champion',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'fighter:weapon-mastery': [],
    ...(speciesId === 'human' ? { 'human:skillful': ['perception'] } : {}),
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'fighter:fighting-style': { featId: 'defense' },
    'fighter:ability-score-improvement': { featId: 'two-weapon-fighting' },
    ...(speciesId === 'human' ? { 'human:versatile': { featId: 'alert' } } : {}),
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const plain = (): CharacterSheet => ({
  level: 3,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

/** A Halfling and a Human, side by side, with a dummy to swing at. */
const LOG: readonly GameEvent[] = [
  ...(unwrap(createCharacter(SRD_CONTENT, choices('halfling', 'Pip'), PIP), 'pip') as GameEvent[]),
  ...(unwrap(createCharacter(SRD_CONTENT, choices('human', 'Bren'), BREN), 'bren') as GameEvent[]),
  { type: 'creature-side-declared', id: PIP, side: 'party' },
  { type: 'creature-side-declared', id: BREN, side: 'party' },
  {
    type: 'creature-added',
    id: GOBLIN,
    name: 'goblin',
    sheet: plain(),
    maxHp: 400,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'goblins',
  },
  {
    type: 'items-gained',
    id: PIP,
    items: [{ id: 'longsword', quantity: 1 }],
    source: 'the quartermaster',
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: PIP, placement: { from: { landmark: 'the road' }, feet: 0 } },
  { type: 'creature-placed', id: BREN, placement: { from: { creature: PIP }, feet: 5, bearing: 180 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: PIP }, feet: 5, bearing: 0 } },
];

const STATE: GameState = fold('seed', LOG);

/** A generator scripted by die size. */
const scripted = (faces: Readonly<Record<number, readonly number[]>>): Rng => {
  const queues = new Map<number, number[]>(
    Object.entries(faces).map(([sides, values]) => [Number(sides), [...values]]),
  );
  return {
    int: (sides: number): number => {
      const queue = queues.get(sides);
      if (queue === undefined || queue.length === 0) {
        throw new Error(`the script has no d${sides} left to throw`);
      }
      return queue.shift()!;
    },
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

const sheetOf = (who: CharacterId): CharacterSheet =>
  sheetAsItStands(STATE, who) ?? (() => { throw new Error('no sheet'); })();

describe('the trait reaches the sheet every roller reads', () => {
  it('is on a Halfling’s sheet, named, and on nobody else’s', () => {
    expect(sheetOf(PIP).rerollsD20On).toEqual({ on: 1, source: 'Luck' });
    expect(sheetOf(BREN).rerollsD20On).toBeUndefined();
  });
});

describe('SRD Luck throws a natural 1 again on every family of D20 Test', () => {
  it('rerolls an ability check and uses the new roll', () => {
    const rolled = unwrap(
      rollAbilityCheck(createRollIssuer('r'), scripted({ 20: [1, 14] }), sheetOf(PIP), 'str', {
        dc: 10,
      }),
      'check',
    );
    expect(rolled.natural).toBe(14);
    expect(rolled.supersedes).toEqual({ natural: 1, total: 1 + rolled.modifier });
    expect(rolled.success).toBe(true);
  });

  it('rerolls a saving throw', () => {
    const rolled = unwrap(
      rollSavingThrow(createRollIssuer('r'), scripted({ 20: [1, 19] }), sheetOf(PIP), 'dex', {
        dc: 15,
      }),
      'save',
    );
    expect(rolled.natural).toBe(19);
    expect(rolled.supersedes?.natural).toBe(1);
  });

  it('rerolls an attack roll, and the log carries both faces', () => {
    const out = unwrap(
      resolveAttack(
        STATE,
        PIP,
        { target: GOBLIN, weapon: 'longsword', free: true },
        { issuer: createRollIssuer('r'), rng: scripted({ 20: [1, 18], 8: [4] }), content: SRD_CONTENT },
      ),
      'attack',
    );
    const record = out.events.find((e) => e.type === 'roll-recorded');
    if (record?.type !== 'roll-recorded') throw new Error('no roll was recorded');
    expect(record.natural).toBe(18);
    expect(record.supersedes?.natural).toBe(1);
    expect(record.outcome).toBe('hit');
    // Two d20s and a damage die, all inside the one `rolls-issued` the command
    // has always emitted.
    expect(out.events.filter((e) => e.type === 'rolls-issued')).toHaveLength(1);
  });

  /**
   * **"You must use the new roll"**, which is the half of the sentence a
   * take-the-better-of-two would get wrong.
   */
  it('keeps a worse new roll', () => {
    const rolled = unwrap(
      rollAbilityCheck(createRollIssuer('r'), scripted({ 20: [1, 2] }), sheetOf(PIP), 'str', {
        dc: 10,
      }),
      'check',
    );
    expect(rolled.natural).toBe(2);
    expect(rolled.success).toBe(false);
  });

  it('throws the new die once and no further', () => {
    const rolled = unwrap(
      rollAbilityCheck(createRollIssuer('r'), scripted({ 20: [1, 1] }), sheetOf(PIP), 'str', {
        dc: 10,
      }),
      'check',
    );
    expect(rolled.natural).toBe(1);
    expect(rolled.supersedes?.natural).toBe(1);
  });

  it('leaves every other face alone', () => {
    for (const face of [2, 7, 13, 20]) {
      const rolled = unwrap(
        rollAbilityCheck(createRollIssuer('r'), scripted({ 20: [face] }), sheetOf(PIP), 'str', {
          dc: 10,
        }),
        'check',
      );
      expect(rolled.natural).toBe(face);
      expect(rolled.supersedes).toBeUndefined();
    }
  });

  it('leaves a creature without the trait with its 1', () => {
    const rolled = unwrap(
      rollAbilityCheck(createRollIssuer('r'), scripted({ 20: [1] }), sheetOf(BREN), 'str', {
        dc: 10,
      }),
      'check',
    );
    expect(rolled.natural).toBe(1);
    expect(rolled.supersedes).toBeUndefined();
  });

  /**
   * Under Advantage two dice are thrown and only one of them counted, so it is
   * that one the rule reaches. Both 1s here, so the reroll lands on the first
   * and the Advantage is taken over the pair that results.
   */
  it('throws the die the mode picked out, and leaves the other standing', () => {
    const rolled = unwrap(
      rollAbilityCheck(createRollIssuer('r'), scripted({ 20: [1, 9, 17] }), sheetOf(PIP), 'str', {
        dc: 10,
        modes: ['disadvantage'],
      }),
      'check',
    );
    // Disadvantage counts the lower of 1 and 9; the 1 is thrown again as a 17,
    // and the 9 — which was never the roll — still stands and now counts.
    expect(rolled.rolls).toEqual([17, 9]);
    expect(rolled.natural).toBe(9);
    expect(rolled.supersedes?.natural).toBe(1);
  });

  /**
   * And the same pair the other way round, which is the case that tells "the
   * die the mode picked out" from "the first die": here the 1 is the *second*
   * throw, and a rule that always replaced the first would leave the 1 to be
   * counted by the Disadvantage.
   */
  it('throws the counted die again even when it was not thrown first', () => {
    const rolled = unwrap(
      rollAbilityCheck(createRollIssuer('r'), scripted({ 20: [9, 1, 17] }), sheetOf(PIP), 'str', {
        dc: 10,
        modes: ['disadvantage'],
      }),
      'check',
    );
    expect(rolled.rolls).toEqual([9, 17]);
    expect(rolled.natural).toBe(9);
    expect(rolled.supersedes?.natural).toBe(1);
  });
});

/**
 * **The two rollers the sheet does not reach by itself, and the reason they
 * are worth their own tests.**
 *
 * Every other D20 Test in the engine comes out of `checks.ts` or `attack.ts`,
 * both of which are handed the sheet and read the trait off it. Initiative is
 * a Dexterity check rolled by `combat.ts`, and a death save is rolled from
 * `Vitals` because the SRD says it "isn't tied to an ability score" — so each
 * needed one line wiring the trait in by hand, and a line wired by hand is a
 * line that can be deleted without anything noticing. These notice.
 */
describe('the two rollers wired by hand', () => {
  // Both of these are Champions, and SRD Remarkable Athlete grants Advantage
  // on Initiative — so two dice are thrown and the rule reaches the one the
  // mode counted, which is the case worth driving anyway.
  it('rerolls a 1 on Initiative', () => {
    const rolled = unwrap(
      rollInitiativeFor(STATE, PIP, createRollIssuer('r'), scripted({ 20: [1, 1, 16] })),
      'initiative',
    );
    expect(rolled.roll.natural).toBe(16);
    expect(rolled.roll.superseded?.natural).toBe(1);
  });

  it('leaves a creature without the trait with its 1 on Initiative', () => {
    const rolled = unwrap(
      rollInitiativeFor(STATE, BREN, createRollIssuer('r'), scripted({ 20: [1, 1] })),
      'initiative',
    );
    expect(rolled.roll.natural).toBe(1);
    expect(rolled.roll.superseded).toBeUndefined();
  });

  /**
   * SRD: "Whenever you start your turn with 0 Hit Points, you must make a
   * Death Saving Throw." Driven through the turn boundary, which is the only
   * door that rolls one, so what is under test is the roll a real fight makes.
   */
  const dying = (who: CharacterId): readonly GameEvent[] => [
    ...LOG,
    {
      type: 'combat-started',
      // The Goblin goes first so that one `resolveTurn` brings the turn round
      // to the creature that is down, which is the boundary that owes the save.
      combatants: [
        { id: GOBLIN, initiative: 20, speed: 30 },
        { id: who, initiative: 10, speed: 25 },
        { id: who === PIP ? BREN : PIP, initiative: 1, speed: 25 },
      ],
    },
    // Exactly what they have, so they drop to 0 with no remainder — a blow
    // whose remainder reached the hit point maximum would be Massive Damage,
    // and the dead make no saves.
    {
      type: 'damage-taken',
      id: who,
      amount: STATE.creatures[who]!.vitals.hp,
      source: 'a very bad day',
    },
    { type: 'condition-applied', id: who, condition: 'unconscious', source: 'zero hit points' },
  ];

  const deathSaveOf = (who: CharacterId, faces: readonly number[]) => {
    const out = unwrap(
      resolveTurn(fold('seed', dying(who)), {
        issuer: createRollIssuer('r'),
        rng: scripted({ 20: faces }),
        content: SRD_CONTENT,
      }),
      'turn',
    );
    const record = out.events.find((e) => e.type === 'death-save-recorded');
    if (record?.type !== 'death-save-recorded') throw new Error('no death save was rolled');
    return record;
  };

  it('rerolls a 1 on a death saving throw', () => {
    expect(deathSaveOf(PIP, [1, 17]).natural).toBe(17);
  });

  it('leaves a creature without the trait with its 1 on a death saving throw', () => {
    expect(deathSaveOf(BREN, [1]).natural).toBe(1);
  });
});

/**
 * **A face a table read out is not the engine's to replace.**
 *
 * `resolveStatedD20` is the other path through the pipeline and the trait must
 * not reach it: physical dice at a real table, or a DM's stated ruling, are
 * numbers the engine records rather than produces — inviolable rule 1 read
 * from the human-DM side. A generator that threw nothing at all is the proof:
 * the 1 stands, and no second die was asked for.
 */
describe('a stated die stands', () => {
  it('does not throw again for a face somebody read out', () => {
    const rolled = unwrap(
      rollAbilityCheck(
        createRollIssuer('r'),
        scripted({}),
        sheetOf(PIP),
        'str',
        { dc: 10, statedRoll: { faces: [1], source: 'physical-dice' } },
      ),
      'stated',
    );
    expect(rolled.natural).toBe(1);
    expect(rolled.supersedes).toBeUndefined();
  });
});

describe('a reroll in the pipeline is deterministic', () => {
  it('replays to the same faces from the same seed', () => {
    const once = unwrap(
      rollAbilityCheck(createRollIssuer('r'), createRng('luck') as Rng, sheetOf(PIP), 'str', {
        dc: 10,
      }),
      'once',
    );
    const again = unwrap(
      rollAbilityCheck(createRollIssuer('r'), createRng('luck') as Rng, sheetOf(PIP), 'str', {
        dc: 10,
      }),
      'again',
    );
    expect(again.natural).toBe(once.natural);
    expect(again.supersedes).toEqual(once.supersedes);
  });
});
