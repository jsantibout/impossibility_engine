import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  type CharacterId,
  isErr,
  expect as unwrap,
  type Result,
} from '@ie/shared';
import {
  addCreature,
  advanceTime,
  beginCombat,
  declareCreatureSide,
  endCombat,
  placeCreatureInScene,
  resolveAttack,
  resolveTurn,
  setScene,
  addSceneLandmark,
  takeStatedBonusAction,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { adaptMonster, bestPrintedMeleeAttack, rechargeOfLine } from './monster.js';
import { beginRest, endRest } from './rest.js';
import { createRollIssuer } from './rolls.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * A stat block line that is not available every round, and the rule that
 * brings it back.
 *
 * SRD *Monsters*, "Recharge X–Y": "This notation means a monster can use the
 * stat block part once. At the start of each of the monster's turns, roll 1d6.
 * If the roll is within the number range given in the notation, the monster
 * regains the use of that part, **which also recharges when the monster
 * finishes a Short or Long Rest**." And the second notation, which is the rest
 * alone: "Recharge after a Short or Long Rest. This notation means the monster
 * can use the stat block part once and must then finish a Short or Long Rest
 * to use it again."
 *
 * Three claims, and they are the reason this file exists rather than a handful
 * of assertions dropped into the files it borrows from:
 *
 * - **The die is the engine's.** A recharge roll is a roll with provenance,
 *   thrown at a boundary the engine already owns, and never a number a caller
 *   brings. A model that could say "it recharged" would be a model rolling.
 * - **A line used is gone until it is not.** Spending it is an event, the
 *   expended state folds out of the log, and using it again is refused as a
 *   value that says what would bring it back.
 * - **Nothing here knows a monster's name.** Every threshold, every line and
 *   every sentence comes off a block; the tests name blocks because the *test*
 *   is content, and the engine reads a field.
 */

const id = (s: string) => asCharacterId(s);
const BREN = id('bren');

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/**
 * Seeds chosen for the face their first d6 shows, and named for it, because
 * every threshold in this file is read against that one number.
 *
 * A recharge roll is the first die a quiet boundary throws, so the seed decides
 * it. Picking the *roll* and varying the *threshold* is what lets one number
 * settle all three printed forms: a 5 brings back a 4–6 and a 5–6, and leaves a
 * 6 where it was.
 */
const ROLLS_FIVE = 'd';
const ROLLS_THREE = 'turn';

/** A level 1 Fighter for the monsters to be in a fight with. */
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
  private readonly log: GameEvent[] = [];

  get state(): GameState {
    return fold('breath', this.log);
  }

  get events(): readonly GameEvent[] {
    return this.log;
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
}

const statBlock = (slug: string) => {
  const found = SRD_CONTENT.monsterById(slug);
  if (found === null) throw new Error(`no such monster: ${slug}`);
  return found;
};

/**
 * A line's heading, read off the block rather than typed out.
 *
 * The heading carries the book's own recharge notation and the book's en dash,
 * and a test that retyped either would be testing its transcription.
 */
const bonusLine = (slug: string, starts: string): string => {
  const found = statBlock(slug).bonusActions.find((line) => line.name.startsWith(starts));
  if (found === undefined) throw new Error(`${slug} prints no Bonus Action starting ${starts}`);
  return found.name;
};

const HASTEN = bonusLine('clay-golem', 'Hasten');
const GAZE = bonusLine('basilisk', 'Petrifying Gaze');
const NIGHTMARE = bonusLine('incubus', 'Nightmare');
const PHANTASMS = bonusLine('cloaker', 'Phantasms');

/** A fighter and one monster, in a fight the monster goes first in. */
const inTheWoods = (monster: string, who: CharacterId): Table => {
  const table = new Table();
  table.do('the fighter arrives', () => createCharacter(SRD_CONTENT, walkOn('Bren'), BREN));
  table.did('the monster arrives', (s) => addCreature(s, SRD_CONTENT, who, monster));
  table.do('the clearing', (s) => setScene(s, { width: 60, depth: 40, height: 20 }));
  table.do('the stump', (s) => addSceneLandmark(s, 'the stump', { x: 20, y: 20, z: 0 }));
  table.do('Bren by the stump', (s) =>
    placeCreatureInScene(s, BREN, { from: { landmark: 'the stump' }, feet: 0 }),
  );
  table.do('the monster beside him', (s) =>
    placeCreatureInScene(s, who, { from: { creature: BREN }, feet: 5, bearing: 90 }),
  );
  table.do('Bren’s side', (s) => declareCreatureSide(s, BREN, 'party'));
  table.do('the monster’s side', (s) => declareCreatureSide(s, who, 'wild'));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: who, initiative: 20, speed: 30 },
      { id: BREN, initiative: 1, speed: 30 },
    ]),
  );
  return table;
};

const taking = (table: Table, who: CharacterId, line: string, commandId?: string) =>
  takeStatedBonusAction(table.state, who, {
    line,
    ...(commandId === undefined ? {} : { commandId }),
  });

/** Round the order back to the monster, which is where its next turn begins. */
const roundTrip = (table: Table, seed: string): GameState => {
  table.did('the monster finishes', (s) => resolveTurn(s, supply(seed)));
  table.did('Bren finishes', (s) => resolveTurn(s, supply(seed)));
  return table.state;
};

const expendedOn = (state: GameState, who: CharacterId): readonly string[] =>
  state.creatures[who]?.expendedLines ?? [];

const ofType = (table: Table, type: GameEvent['type']): readonly GameEvent[] =>
  table.events.filter((event) => event.type === type);

describe('a line the block prints a recharge on', () => {
  const GOLEM = id('golem');

  it('is expended by the use, and the log says so', () => {
    const table = inTheWoods('clay-golem', GOLEM);
    table.did('the golem hastens', (s) => takeStatedBonusAction(s, GOLEM, { line: HASTEN }));

    expect(expendedOn(table.state, GOLEM)).toEqual([HASTEN]);
    const spent = ofType(table, 'printed-line-expended');
    expect(spent).toHaveLength(1);
    expect(spent[0]?.type === 'printed-line-expended' ? spent[0].line : null).toBe(HASTEN);
  });

  /**
   * **A line with no recharge is not expended by being used.** SRD Goblin
   * Warrior's Nimble Escape prints no notation, so it is a Bonus Action and
   * nothing more — and the rule reads the field rather than the section.
   */
  it('leaves a line the block prints no recharge on exactly where it was', () => {
    const goblin = id('goblin');
    const table = inTheWoods('goblin-warrior', goblin);
    table.did('the goblin slips away', (s) =>
      takeStatedBonusAction(s, goblin, { line: 'Nimble Escape' }),
    );

    expect(expendedOn(table.state, goblin)).toEqual([]);
    expect(ofType(table, 'printed-line-expended')).toEqual([]);
  });

  /**
   * The refusal names the line and what would bring it back, because a caller
   * told only "no" would have to read the stat block to find out whether to
   * wait a turn or call a rest.
   */
  it('is refused a second time in the same fight', () => {
    const table = inTheWoods('clay-golem', GOLEM);
    table.did('the golem hastens', (s) => takeStatedBonusAction(s, GOLEM, { line: HASTEN }));
    roundTrip(table, ROLLS_THREE);

    const again = taking(table, GOLEM, HASTEN);
    expect(isErr(again) ? again.code : 'ok').toBe('line_expended');
    expect(isErr(again) ? again.reason : '').toContain(HASTEN);
    expect(isErr(again) ? again.reason : '').toContain('5');

    // And the refusal has no footprint: the Bonus Action is still there to
    // spend on something else.
    expect(table.state.combat?.budgets[GOLEM]?.bonusAction).toBe(true);
  });

  it('comes back on a turn-start roll that makes it', () => {
    const table = inTheWoods('clay-golem', GOLEM);
    table.did('the golem hastens', (s) => takeStatedBonusAction(s, GOLEM, { line: HASTEN }));
    roundTrip(table, ROLLS_FIVE);

    expect(expendedOn(table.state, GOLEM)).toEqual([]);
    const back = ofType(table, 'printed-line-recharged');
    expect(back).toHaveLength(1);
    expect(back[0]?.type === 'printed-line-recharged' ? back[0].line : null).toBe(HASTEN);

    // And it is usable again, which is the whole point of the die.
    const twice = taking(table, GOLEM, HASTEN);
    expect(isErr(twice)).toBe(false);
  });

  /**
   * **The engine rolled it**, and the log says what fell. A recharge that
   * happened without a `roll-recorded` beside it would be a number nobody can
   * audit, which is the one thing the doctrine forbids outright.
   */
  it('records the die it threw, with the generator’s position beside it', () => {
    const table = inTheWoods('clay-golem', GOLEM);
    table.did('the golem hastens', (s) => takeStatedBonusAction(s, GOLEM, { line: HASTEN }));
    roundTrip(table, ROLLS_FIVE);

    const rolled = ofType(table, 'roll-recorded').filter(
      (event) => event.type === 'roll-recorded' && event.label.includes(HASTEN),
    );
    expect(rolled).toHaveLength(1);
    const only = rolled[0];
    expect(only?.type === 'roll-recorded' ? only.natural : 0).toBe(5);
    expect(only?.type === 'roll-recorded' ? only.who : null).toBe(GOLEM);
    expect(ofType(table, 'rolls-issued').length).toBeGreaterThan(0);
  });

  it('stays expended on a roll that does not make it', () => {
    const table = inTheWoods('clay-golem', GOLEM);
    table.did('the golem hastens', (s) => takeStatedBonusAction(s, GOLEM, { line: HASTEN }));
    roundTrip(table, ROLLS_THREE);

    expect(expendedOn(table.state, GOLEM)).toEqual([HASTEN]);
    expect(ofType(table, 'printed-line-recharged')).toEqual([]);

    // The die was still thrown, and the log holds it: a boundary that rolled
    // nothing and a boundary that rolled a 3 are different histories.
    const rolled = ofType(table, 'roll-recorded').filter(
      (event) => event.type === 'roll-recorded' && event.label.includes(HASTEN),
    );
    expect(rolled).toHaveLength(1);
    expect(rolled[0]?.type === 'roll-recorded' ? rolled[0].natural : 0).toBe(3);
  });

  /** Nobody rolls for a line nobody has spent. */
  it('throws no die at a boundary where nothing is expended', () => {
    const table = inTheWoods('clay-golem', GOLEM);
    roundTrip(table, ROLLS_FIVE);

    expect(ofType(table, 'roll-recorded')).toEqual([]);
    expect(ofType(table, 'printed-line-recharged')).toEqual([]);
  });

  /**
   * **A boundary that owes a die and has none refuses**, rather than advancing
   * quietly past a sentence of the book's. The same answer `settleBoundaryPayouts`
   * gives to the same absence, and for the same reason: a recharge is settled
   * in one breath at the boundary and there is nowhere to leave it for later.
   *
   * A turn that owes nothing still needs nothing, which is why `resolveTurn`
   * is callable with no generator at all.
   */
  it('refuses to advance into a turn whose die it cannot throw', () => {
    const table = inTheWoods('clay-golem', GOLEM);
    table.did('the golem hastens', (s) => takeStatedBonusAction(s, GOLEM, { line: HASTEN }));
    table.did('the golem finishes', (s) => resolveTurn(s, supply(ROLLS_FIVE)));

    const dry = resolveTurn(table.state);
    expect(isErr(dry) ? dry.code : 'ok').toBe('recharge_owed');
    expect(isErr(dry) ? dry.reason : '').toContain(GOLEM);
  });
});

/**
 * The three thresholds the book prints, settled by one roll.
 *
 * Every block here is the SRD's own: a 4–6 (Basilisk), a 5–6 (Clay Golem) and
 * a 6 (Incubus), each printed under **Bonus Actions**, which is the section a
 * caller can spend. The seed shows a 5, so the first two come back and the
 * third does not — and a rule that read the notation as "any recharge comes
 * back on any roll" would hand the Incubus its Nightmare back.
 */
describe('the printed threshold', () => {
  const returnsAfter = (monster: string, who: CharacterId, line: string): boolean => {
    const table = inTheWoods(monster, who);
    table.did('the line is used', (s) => takeStatedBonusAction(s, who, { line }));
    expect(expendedOn(table.state, who)).toEqual([line]);
    roundTrip(table, ROLLS_FIVE);
    return expendedOn(table.state, who).length === 0;
  };

  it('brings back a 4–6 on a 5', () => {
    expect(rechargeOfLine(adaptMonster(statBlock('basilisk'), id('b')).sheet, GAZE)).toEqual({
      kind: 'die',
      low: 4,
    });
    expect(returnsAfter('basilisk', id('basilisk'), GAZE)).toBe(true);
  });

  it('brings back a 5–6 on a 5', () => {
    expect(rechargeOfLine(adaptMonster(statBlock('clay-golem'), id('g')).sheet, HASTEN)).toEqual({
      kind: 'die',
      low: 5,
    });
    expect(returnsAfter('clay-golem', id('golem'), HASTEN)).toBe(true);
  });

  it('leaves a 6 expended on a 5', () => {
    expect(rechargeOfLine(adaptMonster(statBlock('incubus'), id('i')).sheet, NIGHTMARE)).toEqual({
      kind: 'die',
      low: 6,
    });
    expect(returnsAfter('incubus', id('incubus'), NIGHTMARE)).toBe(false);
  });
});

/**
 * The rest, which the book gives **both** notations and the owner has ruled on
 * directly: a recharge ability returns on a rest.
 *
 * SRD *Monsters* says it of the die form in the same sentence as the die —
 * "which also recharges when the monster finishes a Short or Long Rest" — and
 * the other notation is that clause with the die taken away. So the difference
 * between the two arms is "a die and a rest" against "a rest alone", and the
 * wrong generous reading is not that rests work but that the *die* does.
 */
describe('a rest', () => {
  const CLOAKER = id('cloaker');
  const GOLEM = id('golem');

  /** Expend the line, leave the fight, and rest for the hour a Short Rest is. */
  const restingAfter = (
    monster: string,
    who: CharacterId,
    line: string,
    kind: 'short' | 'long',
  ): Table => {
    const table = inTheWoods(monster, who);
    table.did('the line is used', (s) => takeStatedBonusAction(s, who, { line }));
    expect(expendedOn(table.state, who)).toEqual([line]);
    table.do('the fight ends', (s) => endCombat(s, { kind: 'surrender', side: 'party' }));
    table.do('the rest begins', (s) => beginRest(s, who, kind));
    table.do('time passes', (s) =>
      advanceTime(s, kind === 'short' ? 3600 : 8 * 3600, 'the rest'),
    );
    table.did('the rest ends', (s) => endRest(s, who));
    return table;
  };

  it('brings back a die-recharge line on a Short Rest', () => {
    const table = restingAfter('clay-golem', GOLEM, HASTEN, 'short');
    expect(expendedOn(table.state, GOLEM)).toEqual([]);
  });

  it('brings back a die-recharge line on a Long Rest', () => {
    const table = restingAfter('clay-golem', GOLEM, HASTEN, 'long');
    expect(expendedOn(table.state, GOLEM)).toEqual([]);
  });

  it('brings back the rest-only line on a Short Rest', () => {
    expect(rechargeOfLine(adaptMonster(statBlock('cloaker'), id('c')).sheet, PHANTASMS)).toEqual({
      kind: 'rest',
    });
    const table = restingAfter('cloaker', CLOAKER, PHANTASMS, 'short');
    expect(expendedOn(table.state, CLOAKER)).toEqual([]);
  });

  /**
   * And the turn is not a rest. The Cloaker's line prints no die, so a
   * boundary throws none for it and the line is exactly where it was — which
   * is the difference the second notation exists to draw.
   */
  it('does not bring the rest-only line back on a turn-start roll', () => {
    const table = inTheWoods('cloaker', CLOAKER);
    table.did('the cloaker casts', (s) =>
      takeStatedBonusAction(s, CLOAKER, { line: PHANTASMS }),
    );
    roundTrip(table, ROLLS_FIVE);

    expect(expendedOn(table.state, CLOAKER)).toEqual([PHANTASMS]);
    expect(ofType(table, 'roll-recorded')).toEqual([]);
    expect(ofType(table, 'printed-line-recharged')).toEqual([]);

    // Even a natural 6 is not a rest.
    roundTrip(table, 'fangs');
    expect(expendedOn(table.state, CLOAKER)).toEqual([PHANTASMS]);
  });
});

/**
 * The other half of what a stat block can spend: an attack whose own name
 * carries the notation.
 *
 * SRD Minotaur of Baphomet prints "Gore (Recharge 5–6)" beside an Abyssal
 * Glaive that does not recharge, and it states no Multiattack — so the two
 * swings are one turn apart and the second Gore is refused by the recharge
 * rather than by the economy.
 */
describe('a printed attack that recharges', () => {
  const MINOTAUR = id('minotaur');
  const GORE = 'Gore (Recharge 5–6)';

  const goring = (table: Table, seed = 'teeth') =>
    resolveAttack(table.state, MINOTAUR, { target: BREN, weapon: null, action: GORE }, supply(seed));

  it('is expended by the swing, hit or miss', () => {
    const table = inTheWoods('minotaur-of-baphomet', MINOTAUR);
    table.did('the minotaur gores', () => goring(table));

    expect(expendedOn(table.state, MINOTAUR)).toEqual([GORE]);
  });

  it('refuses the next swing, with the action unspent', () => {
    const table = inTheWoods('minotaur-of-baphomet', MINOTAUR);
    table.did('the minotaur gores', () => goring(table));
    roundTrip(table, ROLLS_THREE);

    const again = goring(table);
    expect(isErr(again) ? again.code : 'ok').toBe('line_expended');
    expect(table.state.combat?.budgets[MINOTAUR]?.attacksRemaining).toBe(null);

    // The Glaive is untouched: what recharges is a line, not a creature.
    const glaive = resolveAttack(
      table.state,
      MINOTAUR,
      { target: BREN, weapon: null, action: 'Abyssal Glaive' },
      supply('teeth'),
    );
    expect(isErr(glaive)).toBe(false);
  });

  it('comes back at the start of the turn, like any other line', () => {
    const table = inTheWoods('minotaur-of-baphomet', MINOTAUR);
    table.did('the minotaur gores', () => goring(table));
    roundTrip(table, ROLLS_FIVE);

    expect(expendedOn(table.state, MINOTAUR)).toEqual([]);
    expect(isErr(goring(table))).toBe(false);
  });

  /**
   * And the Opportunity Attack still passes it over. The field moved from the
   * attack to the line it is printed on, and the reader that has to leave a
   * breath weapon out of a default choice reads the same fact it always did.
   */
  it('is still not what a provoked creature reaches for', () => {
    const minotaur = adaptMonster(statBlock('minotaur-of-baphomet'), MINOTAUR);
    expect(bestPrintedMeleeAttack(minotaur.sheet)?.name).toBe('Abyssal Glaive');

    const ape = adaptMonster(statBlock('ape'), id('ape'));
    expect(ape.sheet.stated?.attacks?.map((a) => a.name)).toContain('Rock (Recharge 6)');
    expect(bestPrintedMeleeAttack(ape.sheet)?.name).toBe('Fist');
  });
});

/**
 * The Clay Golem's gate, which was built before the recharge existed and has
 * to keep working now that the line it reads is spendable *and* rechargeable.
 *
 * SRD: "The golem makes two Slam attacks, or it makes three Slam attacks if it
 * used Hasten this turn." Two mechanisms meet on one heading — the ledger that
 * remembers the line was taken *this turn*, and the expended state that
 * outlives the turn — and they answer different questions.
 */
describe('the gate the Clay Golem prints', () => {
  const GOLEM = id('golem');

  it('still holds the Attack action to two Slams when nothing was spent', () => {
    const table = inTheWoods('clay-golem', GOLEM);
    expect(table.state.combat?.budgets[GOLEM]?.attacksRemaining).toBe(null);

    const swing = (commandId: string) =>
      table.did(`slam ${commandId}`, (s) =>
        resolveAttack(
          s,
          GOLEM,
          { target: BREN, weapon: null, action: 'Slam', commandId },
          supply('clay'),
        ),
      );
    swing('one');
    swing('two');
    expect(table.state.combat?.budgets[GOLEM]?.attacksRemaining).toBe(0);
  });

  it('opens the third Slam on the turn Hasten was taken, and expends it', () => {
    const table = inTheWoods('clay-golem', GOLEM);
    table.did('the golem hastens', (s) => takeStatedBonusAction(s, GOLEM, { line: HASTEN }));
    expect(expendedOn(table.state, GOLEM)).toEqual([HASTEN]);

    const swing = (commandId: string) =>
      table.did(`slam ${commandId}`, (s) =>
        resolveAttack(
          s,
          GOLEM,
          { target: BREN, weapon: null, action: 'Slam', commandId },
          supply('clay'),
        ),
      );
    swing('one');
    expect(table.state.combat?.budgets[GOLEM]?.attacksRemaining).toBe(2);
    swing('two');
    swing('three');
    expect(table.state.combat?.budgets[GOLEM]?.attacksRemaining).toBe(0);
  });

  /**
   * And on the next turn there is no third Slam, because the line cannot be
   * taken again — which is the gate and the recharge agreeing rather than one
   * of them being read twice.
   */
  it('closes it on a turn the line could not be taken', () => {
    const table = inTheWoods('clay-golem', GOLEM);
    table.did('the golem hastens', (s) => takeStatedBonusAction(s, GOLEM, { line: HASTEN }));
    roundTrip(table, ROLLS_THREE);

    expect(isErr(taking(table, GOLEM, HASTEN))).toBe(true);
    table.did('slam', (s) =>
      resolveAttack(s, GOLEM, { target: BREN, weapon: null, action: 'Slam' }, supply('clay')),
    );
    expect(table.state.combat?.budgets[GOLEM]?.attacksRemaining).toBe(1);
  });
});

describe('the log the rule writes', () => {
  const GOLEM = id('golem');

  /** A retry is not a second use, and not a second expenditure. */
  it('counts a repeated command id once', () => {
    const table = inTheWoods('clay-golem', GOLEM);
    table.did('the golem hastens', (s) =>
      takeStatedBonusAction(s, GOLEM, { line: HASTEN, commandId: 'hasten' }),
    );
    const retry = unwrap(taking(table, GOLEM, HASTEN, 'hasten'), 'the retry');

    expect(retry.events).toEqual([]);
    expect(retry.duplicate).toBe(true);
    expect(ofType(table, 'printed-line-expended')).toHaveLength(1);
    expect(expendedOn(table.state, GOLEM)).toEqual([HASTEN]);
  });

  /** The same log folds to the same state, recharge rolls included. */
  it('folds to the same state twice', () => {
    const table = inTheWoods('clay-golem', GOLEM);
    table.did('the golem hastens', (s) => takeStatedBonusAction(s, GOLEM, { line: HASTEN }));
    roundTrip(table, ROLLS_FIVE);
    table.did('the golem hastens again', (s) =>
      takeStatedBonusAction(s, GOLEM, { line: HASTEN }),
    );

    const log = [...table.events];
    expect(JSON.stringify(fold('breath', log))).toBe(JSON.stringify(fold('breath', log)));
    expect(expendedOn(fold('breath', log), GOLEM)).toEqual([HASTEN]);
  });

  /**
   * **The same seed and the same script write the same log.** Two runs of the
   * whole thing, compared event for event, which is what the recharge die has
   * to survive: it is thrown inside a boundary and nothing else moves the
   * generator there.
   */
  it('replays byte-identically from its seed', () => {
    const run = () => {
      const table = inTheWoods('clay-golem', GOLEM);
      table.did('the golem hastens', (s) => takeStatedBonusAction(s, GOLEM, { line: HASTEN }));
      roundTrip(table, ROLLS_THREE);
      roundTrip(table, ROLLS_FIVE);
      return JSON.stringify(table.events);
    };
    expect(run()).toBe(run());
  });
});
