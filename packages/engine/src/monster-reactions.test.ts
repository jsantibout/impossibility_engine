import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type Result } from '@ie/shared';
import {
  addCreature,
  beginCombat,
  declareCreatureSide,
  declineTestReaction,
  placeCreatureInScene,
  resolveTest,
  setScene,
  addSceneLandmark,
  settleTest,
  takeTestReaction,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { adaptMonster, printedLinePoolKey } from './monster.js';
import { createRollIssuer } from './rolls.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { remaining } from './resources.js';

/**
 * A Reaction a **stat block** prints, answered at the window the engine
 * already holds.
 *
 * SRD Sphinx of Wonder, Burst of Ingenuity (2/Day): "_Trigger:_ The sphinx or
 * another creature within 30 feet makes an ability check or a saving throw.
 * _Response:_ The sphinx adds 2 to the roll."
 *
 * Every part of it was already built and none of it was reachable: the
 * `test-rolled` window is where Dark One's Own Luck and Indomitable live,
 * `intervene` is the push with a sign, and `offersForTest` has always reached
 * a reactor who is not the roller because Cutting Words does. What was missing
 * was the Reactions section of a stat block, which had never reached a sheet —
 * so the sphinx arrived with an empty `reactions` list and a heading nobody
 * could spend.
 *
 * It is a Pact of the Chain familiar's form, so a Warlock's table reaches it.
 */

const id = (s: string) => asCharacterId(s);
const BREN = id('bren');
const SPHINX = id('sphinx');

const SEED = 'wonder';

const supply = (seed = SEED) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

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

class Table {
  private readonly log: GameEvent[] = [];

  get state(): GameState {
    return fold(SEED, this.log);
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

/** The block's own heading, read off the block rather than retyped. */
const BURST = SRD_CONTENT.monsterById('sphinx-of-wonder')!.reactions[0]!.name;

/**
 * Bren, and the sphinx a stated distance away.
 *
 * The distance is the argument of every test here, so it is the parameter.
 */
const aroundTheStump = (feet: number, fighting = true): Table => {
  const table = new Table();
  table.do('Bren arrives', () => createCharacter(SRD_CONTENT, walkOn('Bren'), BREN));
  table.did('the sphinx arrives', (s) => addCreature(s, SRD_CONTENT, SPHINX, 'sphinx-of-wonder'));
  table.do('the clearing', (s) => setScene(s, { width: 120, depth: 80, height: 40 }));
  table.do('the stump', (s) => addSceneLandmark(s, 'the stump', { x: 20, y: 20, z: 0 }));
  table.do('Bren by the stump', (s) =>
    placeCreatureInScene(s, BREN, { from: { landmark: 'the stump' }, feet: 0 }),
  );
  table.do('the sphinx above him', (s) =>
    placeCreatureInScene(s, SPHINX, { from: { creature: BREN }, feet, bearing: 90 }),
  );
  table.do('Bren’s side', (s) => declareCreatureSide(s, BREN, 'party'));
  table.do('the sphinx’s side', (s) => declareCreatureSide(s, SPHINX, 'party'));
  if (fighting) {
    table.do('the order', (s) =>
      beginCombat(s, [
        { id: BREN, initiative: 20, speed: 30 },
        { id: SPHINX, initiative: 1, speed: 30 },
      ]),
    );
  }
  return table;
};

describe('the adapter reads the Reactions section', () => {
  it('compiles Burst of Ingenuity into the window the engine holds', () => {
    const sphinx = adaptMonster(SRD_CONTENT.monsterById('sphinx-of-wonder')!, SPHINX);
    expect(sphinx.sheet.reactions).toEqual([
      {
        feature: 'sphinx-of-wonder:burst-of-ingenuity-2-day',
        name: BURST,
        window: 'test-rolled',
        costsReaction: true,
        pool: printedLinePoolKey(BURST),
        reach: { kind: 'self-or-within', feet: 30 },
        does: {
          kind: 'intervene',
          amount: { plus: [{ kind: 'flat', amount: 2, label: BURST }] },
          direction: 'bonus',
          tests: ['ability-check', 'saving-throw'],
          outcome: 'either',
        },
      },
    ]);
  });

  it('declares the pool the day’s uses come out of, beside any the casting needs', () => {
    const sphinx = adaptMonster(SRD_CONTENT.monsterById('sphinx-of-wonder')!, SPHINX);
    expect(sphinx.pools).toEqual([
      { key: printedLinePoolKey(BURST), label: BURST, max: 2, recovers: 'dawn' },
    ]);
  });

  it('leaves a block whose Reactions the engine cannot apply with none', () => {
    // SRD Parry adds to an Armour Class against one attack, which is a window
    // this engine does not hold; the line stays prose and stays on the ledger.
    const captain = adaptMonster(SRD_CONTENT.monsterById('bandit-captain')!, SPHINX);
    expect(captain.sheet.reactions).toBeUndefined();
    expect(captain.pools).toEqual([]);
  });
});

describe('the sphinx adds two to somebody else’s roll', () => {
  it('is offered at 25 feet and adds 2 to an ally’s saving throw', () => {
    const table = aroundTheStump(25);
    const rolled = unwrap(
      resolveTest(table.state, BREN, { kind: 'saving-throw', ability: 'dex', dc: 14 }, supply()),
      'the save',
    );
    expect(rolled.offers.filter((o) => o.reactor === SPHINX)).toEqual([
      {
        reactor: SPHINX,
        feature: 'sphinx-of-wonder:burst-of-ingenuity-2-day',
        name: BURST,
        costsReaction: true,
        pool: printedLinePoolKey(BURST),
      },
    ]);

    const before = rolled.test!.total;
    const on = table.do('the save', () => ({ ok: true, value: rolled.events }));
    const pushed = unwrap(
      takeTestReaction(
        on,
        SPHINX,
        { feature: 'sphinx-of-wonder:burst-of-ingenuity-2-day' },
        supply(),
      ),
      'the burst',
    );
    expect(pushed.test!.total).toBe(before + 2);

    const after = table.do('the burst', () => ({ ok: true, value: pushed.events }));
    // One of the day's two uses, out of the pool the block declared.
    expect(remaining(after.creatures[SPHINX]!.resources, printedLinePoolKey(BURST))).toBe(1);
    // And the Reaction the heading costs.
    expect(after.combat!.budgets[SPHINX]!.reaction).toBe(false);
  });

  it('is not offered at 35 feet', () => {
    const table = aroundTheStump(35);
    const rolled = unwrap(
      resolveTest(table.state, BREN, { kind: 'saving-throw', ability: 'dex', dc: 14 }, supply()),
      'the save',
    );
    // Bren's own Heroic Inspiration answers his own save whatever the sphinx
    // does, which is what makes the filter here the claim rather than noise.
    expect(rolled.offers.filter((o) => o.reactor === SPHINX)).toEqual([]);
  });

  it('answers the sphinx’s own roll, which "the sphinx or another creature" names', () => {
    const table = aroundTheStump(25);
    const rolled = unwrap(
      resolveTest(table.state, SPHINX, { kind: 'ability-check', ability: 'int', dc: 15 }, supply()),
      'the check',
    );
    expect(rolled.offers.map((o) => o.reactor)).toEqual([SPHINX]);
  });

  it('is offered only while the day’s uses remain', () => {
    // Out of combat, where the Reaction is not part of an economy and the pool
    // is the only thing that can run out — which is what this test is about.
    // SRD's day is a day whether or not anybody is fighting.
    const table = aroundTheStump(25, false);
    for (const round of [0, 1]) {
      const rolled = unwrap(
        resolveTest(
          table.state,
          BREN,
          { kind: 'saving-throw', ability: 'dex', dc: 14, commandId: `save-${round}` },
          supply(),
        ),
        'the save',
      );
      expect(rolled.offers.filter((o) => o.reactor === SPHINX).length).toBe(1);
      table.do('the save', () => ({ ok: true, value: rolled.events }));
      const pushed = unwrap(
        takeTestReaction(
          table.state,
          SPHINX,
          { feature: 'sphinx-of-wonder:burst-of-ingenuity-2-day', commandId: `burst-${round}` },
          supply(),
        ),
        'the burst',
      );
      table.do('the burst', () => ({ ok: true, value: pushed.events }));
      // Bren's own Heroic Inspiration was offered on the same roll, and the
      // window stays open until every taker has answered.
      table.do('Bren keeps his', (s) =>
        declineTestReaction(s, BREN, { commandId: `bren-passes-${round}` }),
      );
      table.did('the window closes', (s) => settleTest(s, { commandId: `settle-${round}` }));
    }

    const spent = unwrap(
      resolveTest(
        table.state,
        BREN,
        { kind: 'saving-throw', ability: 'dex', dc: 14, commandId: 'save-2' },
        supply(),
      ),
      'the third save',
    );
    expect(spent.offers.filter((o) => o.reactor === SPHINX)).toEqual([]);
    expect(remaining(table.state.creatures[SPHINX]!.resources, printedLinePoolKey(BURST))).toBe(0);

    // And naming it anyway is refused rather than quietly spent.
    const on = table.do('the third save', () => ({ ok: true, value: spent.events }));
    const refused = takeTestReaction(
      on,
      SPHINX,
      { feature: 'sphinx-of-wonder:burst-of-ingenuity-2-day', commandId: 'burst-2' },
      supply(),
    );
    expect(isErr(refused) && refused.code).toBe('not_offered');
  });

  it('may be declined, and then the roll stands', () => {
    const table = aroundTheStump(25);
    const rolled = unwrap(
      resolveTest(table.state, BREN, { kind: 'saving-throw', ability: 'dex', dc: 14 }, supply()),
      'the save',
    );
    const on = table.do('the save', () => ({ ok: true, value: rolled.events }));
    const passed = unwrap(declineTestReaction(on, SPHINX), 'the sphinx passes');
    const after = table.do('the pass', () => ({ ok: true, value: passed }));
    expect(after.pendingTest?.offers.some((o) => o.reactor === SPHINX)).toBe(false);
    expect(remaining(after.creatures[SPHINX]!.resources, printedLinePoolKey(BURST))).toBe(2);
  });
});
