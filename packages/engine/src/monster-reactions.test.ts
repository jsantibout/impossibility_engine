import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type Result } from '@ie/shared';
import {
  addCreature,
  awardItems,
  beginCombat,
  declareCreatureSide,
  declineTestReaction,
  equipItem,
  placeCreatureInScene,
  reactionOpportunities,
  resolveAttack,
  resolveTest,
  setScene,
  addSceneLandmark,
  settleTest,
  takeAttackReaction,
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
    // SRD Redirect Attack opens its window **before** the roll is decided and
    // then re-aims the attack at somebody else — two rules the engine does not
    // have. The line is read as a kind so the ledger stops calling it unread,
    // and nothing compiles onto the sheet from it.
    const boss = adaptMonster(SRD_CONTENT.monsterById('goblin-boss')!, SPHINX);
    expect(boss.sheet.reactions).toBeUndefined();
    expect(boss.pools).toEqual([]);
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

/**
 * SRD Parry, at the window SRD *Shield* already answered.
 *
 * "_Trigger:_ The knight is hit by a melee attack roll while holding a weapon.
 * _Response:_ The knight adds 2 to its AC against that attack, possibly
 * causing it to miss."
 *
 * Every part of it was built except the reading. `hit-by-attack` is the
 * instant *Shield* answers — the roll is known and the damage is not —
 * `PendingAttack` carries the total, the natural and the Armour Class the
 * swing was measured against, and `deflectTriggeringAttack` has re-decided a
 * held hit against a raised number since Shield landed. What Parry adds is a
 * rise that belongs to **one attack** rather than to the creature: nothing is
 * granted, nothing ends, and the number is spent by the blow it answered.
 */
describe('a Reaction a stat block prints against the blow that triggered it', () => {
  const KNIGHT = id('knight');
  const BANDIT = id('bandit');
  const PARRY = 'knight:parry';

  /** The knight and a bandit within reach of it, in a fight. */
  const facingOff = (): Table => {
    const table = new Table();
    table.did('the knight arrives', (s) => addCreature(s, SRD_CONTENT, KNIGHT, 'knight'));
    table.did('a bandit arrives', (s) => addCreature(s, SRD_CONTENT, BANDIT, 'bandit'));
    table.do('the road', (s) => setScene(s, { width: 120, depth: 80, height: 40 }));
    table.do('the milestone', (s) => addSceneLandmark(s, 'the milestone', { x: 20, y: 20, z: 0 }));
    table.do('the knight by it', (s) =>
      placeCreatureInScene(s, KNIGHT, { from: { landmark: 'the milestone' }, feet: 0 }),
    );
    table.do('the bandit in front', (s) =>
      placeCreatureInScene(s, BANDIT, { from: { creature: KNIGHT }, feet: 5, bearing: 90 }),
    );
    table.do('the knight’s side', (s) => declareCreatureSide(s, KNIGHT, 'party'));
    table.do('the bandit’s side', (s) => declareCreatureSide(s, BANDIT, 'monsters'));
    table.do('the order', (s) =>
      beginCombat(s, [
        { id: BANDIT, initiative: 20, speed: 30 },
        { id: KNIGHT, initiative: 1, speed: 30 },
      ]),
    );
    return table;
  };

  /**
   * A held swing whose total is the number this test is about.
   *
   * The engine rolls and the test chooses which of its rolls to talk about,
   * which is the only way to write "hit by exactly its Armour Class" without
   * stating a die face. Both numbers below are inside a d20 plus the bandit's
   * +3, so the search always finds one.
   */
  const swingTotalling = (table: Table, want: number, line = 'Scimitar') => {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const swung = unwrap(
        resolveAttack(
          table.state,
          BANDIT,
          { target: KNIGHT, weapon: null, action: line, hold: true, commandId: `swing-${attempt}` },
          supply(`swing-${attempt}`),
        ),
        'the swing',
      );
      if (swung.attack?.total === want && swung.attack.hit) return swung.events;
    }
    throw new Error(`no seed made ${line} total ${want}`);
  };

  /** The knight's Armour Class, read off the block rather than retyped. */
  const AC = SRD_CONTENT.monsterById('knight')!.ac;

  it('compiles Parry into the window the engine holds', () => {
    const knight = adaptMonster(SRD_CONTENT.monsterById('knight')!, KNIGHT);
    expect(knight.sheet.reactions).toEqual([
      {
        feature: PARRY,
        name: 'Parry',
        window: 'hit-by-attack',
        costsReaction: true,
        pool: null,
        reach: { kind: 'self' },
        does: { kind: 'raise-ac', amount: 2, meleeOnly: true, requiresWeapon: true },
      },
    ]);
  });

  it('turns a blow that hit by nothing into a miss, and spends the Reaction', () => {
    const table = facingOff();
    const held = table.do('the swing', () => ({ ok: true, value: swingTotalling(table, AC) }));
    expect(held.pendingAttack?.targetAc).toBe(AC);

    // The offer the engine makes before anybody asks for it.
    expect(
      reactionOpportunities(held, SRD_CONTENT).filter((o) => o.reactor === KNIGHT),
    ).toEqual([
      {
        window: 'hit-by-attack',
        reactor: KNIGHT,
        id: PARRY,
        name: 'Parry',
        kind: 'feature',
        costsReaction: true,
        pool: null,
        against: BANDIT,
      },
    ]);

    const parried = unwrap(
      takeAttackReaction(held, KNIGHT, { feature: PARRY }, supply()),
      'the parry',
    );
    expect(parried.missed).toBe(true);
    // **And the clause it could not check is said out loud.** A stat block's
    // gear is printed and read by nothing, so "while holding a weapon" is a
    // fact nobody has declared about this knight — the Reaction is allowed and
    // the reader is told, which is the direction every undeclared fact takes.
    expect(parried.unverified.join(' ')).toContain('what knight is holding');

    const after = table.do('the parry', () => ({ ok: true, value: parried.events }));
    // The hold is closed and no damage was ever rolled: 18 against a 20 is a
    // miss, and a miss settles the swing rather than leaving it open.
    expect(after.pendingAttack).toBeNull();
    expect(after.creatures[KNIGHT]!.vitals.hp).toBe(
      SRD_CONTENT.monsterById('knight')!.hp.average,
    );
    expect(after.combat!.budgets[KNIGHT]!.reaction).toBe(false);
  });

  /** "**possibly** causing it to miss": three over the number is still a hit. */
  it('spends the Reaction and lets a blow that hit by three land anyway', () => {
    const table = facingOff();
    const held = table.do('the swing', () => ({ ok: true, value: swingTotalling(table, AC + 3) }));
    const parried = unwrap(
      takeAttackReaction(held, KNIGHT, { feature: PARRY }, supply()),
      'the parry',
    );
    expect(parried.missed).toBe(false);

    const after = table.do('the parry', () => ({ ok: true, value: parried.events }));
    // The hold stands, so the bandit still rolls its damage.
    expect(after.pendingAttack).not.toBeNull();
    expect(after.combat!.budgets[KNIGHT]!.reaction).toBe(false);
  });

  /** "hit by a **melee** attack roll": a bolt is not one. */
  it('is not offered against an arrow, and refuses one that is named anyway', () => {
    const table = facingOff();
    const held = table.do('the shot', () => ({
      ok: true,
      value: swingTotalling(table, AC, 'Light Crossbow'),
    }));
    expect(reactionOpportunities(held, SRD_CONTENT).filter((o) => o.reactor === KNIGHT)).toEqual(
      [],
    );
    const refused = takeAttackReaction(held, KNIGHT, { feature: PARRY }, supply());
    expect(isErr(refused) && refused.code).toBe('melee_only');
  });

  /**
   * "**while holding a weapon**", which the engine can only answer about a
   * creature whose hands somebody has declared. A stat block's `gear` is
   * printed and read by nothing, so a knight nobody has equipped is offered
   * the Reaction and the fact is reported — the direction `reaches` already
   * takes about an undeclared sight line. A knight holding a shield and
   * nothing else has had its hands declared, and the clause is false.
   */
  it('is withheld from a knight whose hands hold no weapon', () => {
    const table = facingOff();
    table.do('a shield, and nothing else', (s) =>
      awardItems(s, supply(), KNIGHT, [{ id: 'shield' }], 'the squire'),
    );
    table.do('the shield up', (s) => equipItem(s, SRD_CONTENT, KNIGHT, 'shield'));
    const held = table.do('the swing', () => ({ ok: true, value: swingTotalling(table, AC) }));

    expect(reactionOpportunities(held, SRD_CONTENT).filter((o) => o.reactor === KNIGHT)).toEqual(
      [],
    );
    const refused = takeAttackReaction(held, KNIGHT, { feature: PARRY }, supply());
    expect(isErr(refused) && refused.code).toBe('no_weapon_in_hand');
  });

  it('is not offered to a knight whose Reaction is already spent', () => {
    const table = facingOff();
    table.do('the Reaction goes elsewhere', () => ({
      ok: true,
      value: [{ type: 'reaction-spent' as const, id: KNIGHT }],
    }));
    const held = table.do('the swing', () => ({ ok: true, value: swingTotalling(table, AC) }));
    expect(reactionOpportunities(held, SRD_CONTENT).filter((o) => o.reactor === KNIGHT)).toEqual(
      [],
    );
    const refused = takeAttackReaction(held, KNIGHT, { feature: PARRY }, supply());
    expect(isErr(refused) && refused.code).toBe('no_reaction');
  });

  it('refuses a Parry with no blow waiting for one', () => {
    const table = facingOff();
    const refused = takeAttackReaction(table.state, KNIGHT, { feature: PARRY }, supply());
    expect(isErr(refused) && refused.code).toBe('no_pending_attack');
  });
});

/**
 * The other Reaction the Reactions section prints that the engine can read: one
 * whose whole **response** is another line of the same block.
 *
 * SRD Rust Monster, Reflexive Antennae: "_Trigger:_ An attack roll hits the
 * rust monster. _Response:_ The rust monster uses Antennae." The trigger is
 * the window above; the response is a printed line, and the rust monster's
 * Antennae is a save nothing has read yet. So the Reaction is offered, the
 * Reaction is spent, and the response is handed to the table **by name** —
 * which is what a handover is, rather than half a sentence performed.
 */
describe('a Reaction whose response is another printed line', () => {
  const RUST = id('rust');
  const BANDIT = id('bandit');
  const REFLEX = 'rust-monster:reflexive-antennae';

  const facingOff = (): Table => {
    const table = new Table();
    table.did('the rust monster arrives', (s) =>
      addCreature(s, SRD_CONTENT, RUST, 'rust-monster'),
    );
    table.did('a bandit arrives', (s) => addCreature(s, SRD_CONTENT, BANDIT, 'bandit'));
    table.do('the tunnel', (s) => setScene(s, { width: 120, depth: 80, height: 40 }));
    table.do('the ore', (s) => addSceneLandmark(s, 'the ore', { x: 20, y: 20, z: 0 }));
    table.do('the rust monster by it', (s) =>
      placeCreatureInScene(s, RUST, { from: { landmark: 'the ore' }, feet: 0 }),
    );
    table.do('the bandit in front', (s) =>
      placeCreatureInScene(s, BANDIT, { from: { creature: RUST }, feet: 5, bearing: 90 }),
    );
    table.do('the rust monster’s side', (s) => declareCreatureSide(s, RUST, 'monsters'));
    table.do('the bandit’s side', (s) => declareCreatureSide(s, BANDIT, 'party'));
    table.do('the order', (s) =>
      beginCombat(s, [
        { id: BANDIT, initiative: 20, speed: 30 },
        { id: RUST, initiative: 1, speed: 30 },
      ]),
    );
    return table;
  };

  const heldHit = (table: Table) => {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const swung = unwrap(
        resolveAttack(
          table.state,
          BANDIT,
          { target: RUST, weapon: null, action: 'Scimitar', hold: true, commandId: `s-${attempt}` },
          supply(`s-${attempt}`),
        ),
        'the swing',
      );
      if (swung.attack?.hit === true) return swung.events;
    }
    throw new Error('no seed hit the rust monster');
  };

  it('compiles the response as the name of a line and nothing more', () => {
    const rust = adaptMonster(SRD_CONTENT.monsterById('rust-monster')!, RUST);
    expect(rust.sheet.reactions).toEqual([
      {
        feature: REFLEX,
        name: 'Reflexive Antennae',
        window: 'hit-by-attack',
        costsReaction: true,
        pool: null,
        reach: { kind: 'self' },
        does: { kind: 'use-printed-line', line: 'Antennae' },
      },
    ]);
  });

  /** A bolt hits it too: this trigger says "an attack roll", not a melee one. */
  it('is offered against any attack roll that hits', () => {
    const table = facingOff();
    const held = table.do('the swing', () => ({ ok: true, value: heldHit(table) }));
    expect(reactionOpportunities(held, SRD_CONTENT).filter((o) => o.reactor === RUST)).toEqual([
      {
        window: 'hit-by-attack',
        reactor: RUST,
        id: REFLEX,
        name: 'Reflexive Antennae',
        kind: 'feature',
        costsReaction: true,
        pool: null,
        against: BANDIT,
      },
    ]);
  });

  it('spends the Reaction and hands the response over by name', () => {
    const table = facingOff();
    const held = table.do('the swing', () => ({ ok: true, value: heldHit(table) }));
    const taken = unwrap(
      takeAttackReaction(held, RUST, { feature: REFLEX }, supply()),
      'the antennae',
    );

    // Nothing was decided about the blow: the hold stands and the damage is
    // still the bandit's to roll.
    expect(taken.missed).toBe(false);
    expect(taken.unverified.join(' ')).toContain('Antennae');

    const after = table.do('the antennae', () => ({ ok: true, value: taken.events }));
    expect(after.pendingAttack).not.toBeNull();
    expect(after.combat!.budgets[RUST]!.reaction).toBe(false);
    // And the log says a Reaction happened, which is the only record of it:
    // nothing was held back and no number moved.
    expect(
      taken.events.some((e) => e.type === 'reaction-taken' && e.window === 'hit-by-attack'),
    ).toBe(true);
  });
});
