/**
 * A line the book prints once a day, and the sunrise that gives it back.
 *
 * SRD stat blocks print two different sentences about how often a line may be
 * used, inside the heading and nowhere else. One is a recharge —
 * "(Recharge 5–6)" — a d6 at the start of the creature's turn, and a rest.
 * The other is a **count**: "Dominate Mind (2/Day)", "Divine Aid (3/Day)",
 * "Fetid Cloud (1/Day)". Sixty headings across fifty-four of the SRD's three
 * hundred and thirty blocks print one, and no heading in the book prints both.
 *
 * Three claims, and they are why this file stands beside `recharge.test.ts`
 * rather than inside it:
 *
 * - **The clock is dawn, not a rest.** The owner has ruled it directly. The
 *   engine's `Recovery` vocabulary has carried `dawn` apart from the two rest
 *   tags since pools landed, and the recharge rule leans on that distinction
 *   in one direction — "Dawn is not a rest" — so this rule leans on it in the
 *   other. A party that sleeps through the afternoon gets no Divine Aid back.
 * - **A count, not a flag.** A 2/Day line is taken twice. What the creature
 *   carries is uses-so-far, which is why this is a number per line and not a
 *   name on the expended list; and the third use is refused before a single
 *   point of the action economy is spent.
 * - **Nothing here knows a monster's name.** The blocks are written in this
 *   file because a *test* is content, and the engine reads a field. The
 *   generated SRD bestiary cannot serve: it predates the field and this
 *   worktree may not regenerate it, so the blocks below carry it themselves
 *   through the same `extendContent` door homebrew takes.
 */
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  type CharacterId,
  isErr,
  expect as unwrap,
  type Result,
} from '@ie/shared';
import type { Monster } from '@ie/srd';
import {
  addCreature,
  addSceneLandmark,
  advanceTime,
  beginCombat,
  declareCreatureSide,
  declareDawn,
  declareResourcePool,
  endCombat,
  placeCreatureInScene,
  resolveTurn,
  restoreResourcesOn,
  setScene,
  takeStatedAction,
  takeStatedBonusAction,
} from './commands.js';
import { extendContent, type Content } from './content.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { adaptMonster, bestPrintedMeleeAttack, perDayOfLine } from './monster.js';
import { beginRest, endRest } from './rest.js';
import { createRollIssuer } from './rolls.js';
import { createCharacter, type CharacterChoices } from './creation.js';

const id = (s: string) => asCharacterId(s);
const BREN = id('bren');
const HERALD = id('herald');

/** The headings, spelled once, in the book's own shape. */
const SUNBURST = 'Sunburst (2/Day)';
const SHOUT = 'Rallying Shout';
const DAWNSTEP = 'Dawnstep (1/Day)';
const GLIMMER = 'Glimmer';

/**
 * A stat block that exists in this file and nowhere the SRD prints.
 *
 * Homebrew on purpose and in the shape the book's own entries are in — the
 * pattern `monster-content.test.ts` established — because the parsed bestiary
 * in `packages/srd/src/generated/` predates the field and a worktree may not
 * regenerate it. What is asserted about the *book* is asserted where the book
 * is parsed, in `parse/monster-attacks.test.ts`; what is asserted here is the
 * rule, driven on a block carrying exactly the four cases it has to tell
 * apart: an Actions line with a limit, an Actions line without one, a Bonus
 * Action line with a limit, and a Bonus Action line without one.
 */
const DAWN_HERALD: Monster = {
  id: 'dawn-herald',
  name: 'Dawn Herald',
  size: 'medium',
  alternateSizes: [],
  type: 'Celestial',
  subtype: null,
  swarmMemberSize: null,
  alignment: 'Lawful Good',
  ac: 15,
  initiative: 3,
  hp: { average: 60, formula: '8d8 + 24' },
  speed: { walk: 30, burrow: null, climb: null, fly: 60, swim: null, hover: false },
  abilities: {
    str: { score: 16, modifier: 3, save: 3 },
    dex: { score: 16, modifier: 3, save: 3 },
    con: { score: 16, modifier: 3, save: 3 },
    int: { score: 12, modifier: 1, save: 1 },
    wis: { score: 14, modifier: 2, save: 2 },
    cha: { score: 16, modifier: 3, save: 3 },
  },
  skills: { perception: 4 },
  vulnerabilities: [],
  resistances: [],
  immunities: [],
  gear: [],
  senses: ['Darkvision 60 ft.'],
  passivePerception: 14,
  languages: ['Celestial'],
  cr: 4,
  crLabel: '4',
  xp: 1100,
  proficiencyBonus: 2,
  traits: [],
  actions: [
    {
      name: 'Talons',
      text: 'Melee Attack Roll: +5, reach 5 ft. Hit: 7 (1d10 + 2) Slashing damage.',
      attack: {
        kind: 'melee',
        modifier: 5,
        reach: 5,
        range: null,
        damage: [{ dice: '1d10', flat: 2, type: 'slashing', average: 7 }],
        qualification: null,
        rider: null,
      },
    },
    {
      name: SUNBURST,
      text: 'Constitution Saving Throw: DC 13, each creature in a 20-foot Emanation. Failure: 14 (4d6) Radiant damage.',
      perDay: 2,
    },
    { name: SHOUT, text: 'The herald calls out, and its allies take heart.' },
  ],
  bonusActions: [
    { name: DAWNSTEP, text: 'The herald teleports up to 30 feet to an unoccupied space it can see.', perDay: 1 },
    { name: GLIMMER, text: 'The herald sheds Bright Light in a 10-foot radius until the end of its next turn.' },
  ],
  reactions: [],
  legendaryActions: [],
};

/**
 * A second block, for the one rule that reads the field off an **attack**.
 *
 * Its harder melee line is the one the book prints once a day, which is
 * exactly the case `bestPrintedMeleeAttack` has to get wrong to be wrong: the
 * default Opportunity Attack must not be a creature's once-a-day breath, for
 * the same reason it is already not its recharging one. No SRD block prints
 * the notation on an attack line, so a homebrew one is the only way to drive
 * it — and homebrew reaches `adaptMonster` through the same door the book
 * does.
 */
const SUN_LION: Monster = {
  ...DAWN_HERALD,
  id: 'sun-lion',
  name: 'Sun Lion',
  bonusActions: [],
  actions: [
    {
      name: 'Claw',
      text: 'Melee Attack Roll: +5, reach 5 ft. Hit: 7 (1d10 + 2) Slashing damage.',
      attack: {
        kind: 'melee',
        modifier: 5,
        reach: 5,
        range: null,
        damage: [{ dice: '1d10', flat: 2, type: 'slashing', average: 7 }],
        qualification: null,
        rider: null,
      },
    },
    {
      name: 'Solar Maul (1/Day)',
      text: 'Melee Attack Roll: +7, reach 10 ft. Hit: 22 (4d8 + 4) Radiant damage.',
      perDay: 1,
      attack: {
        kind: 'melee',
        modifier: 7,
        reach: 10,
        range: null,
        damage: [{ dice: '4d8', flat: 4, type: 'radiant', average: 22 }],
        qualification: null,
        rider: null,
      },
    },
  ],
};

const CONTENT: Content = unwrap(
  extendContent(SRD_CONTENT, { monsters: [DAWN_HERALD, SUN_LION] }),
  'the heralds beside the book',
);

const supply = (seed = 'dawn') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: CONTENT,
});

/** A level 1 Fighter for the herald to be in a fight with. */
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
    return fold('sunrise', this.log);
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

/** A fighter and one monster, in a fight the monster goes first in. */
const inTheWoods = (monster: string, who: CharacterId): Table => {
  const table = new Table();
  table.do('the fighter arrives', () => createCharacter(CONTENT, walkOn('Bren'), BREN));
  table.did('the monster arrives', (s) => addCreature(s, CONTENT, who, monster));
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

/** Round the order back to the monster, which is where its next turn begins. */
const roundTrip = (table: Table, seed = 'dawn'): GameState => {
  table.did('the monster finishes', (s) => resolveTurn(s, supply(seed)));
  table.did('Bren finishes', (s) => resolveTurn(s, supply(seed)));
  return table.state;
};

const usedToday = (state: GameState, who: CharacterId): Readonly<Record<string, number>> =>
  state.creatures[who]?.linesUsedToday ?? {};

const ofType = (table: Table, type: GameEvent['type']): readonly GameEvent[] =>
  table.events.filter((event) => event.type === type);

/** The herald's sheet, with nothing folded — what `adaptMonster` pinned. */
const sheetOf = (monster: Monster) => adaptMonster(monster, HERALD).sheet;

describe('the limit a heading prints', () => {
  it('reaches the sheet from every section a caller can spend', () => {
    const sheet = sheetOf(DAWN_HERALD);
    expect(perDayOfLine(sheet, SUNBURST)).toBe(2);
    expect(perDayOfLine(sheet, DAWNSTEP)).toBe(1);
    expect(perDayOfLine(sheet, 'Solar Maul (1/Day)')).toBeNull();
    expect(perDayOfLine(sheetOf(SUN_LION), 'Solar Maul (1/Day)')).toBe(1);
  });

  /** A line the heading prints no limit on is one a creature takes every turn. */
  it('is absent on a line the heading prints none on', () => {
    const sheet = sheetOf(DAWN_HERALD);
    expect(perDayOfLine(sheet, SHOUT)).toBeNull();
    expect(perDayOfLine(sheet, GLIMMER)).toBeNull();
    expect(perDayOfLine(sheet, 'Talons')).toBeNull();
    expect(perDayOfLine(sheet, 'A Line Nobody Prints')).toBeNull();
  });

  /** The heading is something a caller types, so the lookup reads it that way. */
  it('is found however the heading is capitalised', () => {
    expect(perDayOfLine(sheetOf(DAWN_HERALD), '  sunburst (2/day)  ')).toBe(2);
  });

  /**
   * **And the default Opportunity Attack does not reach for it.** SRD grants
   * "one melee attack" and the engine picks the best the block prints; a line
   * the creature has once a day is not the one it reaches for by default, for
   * the same reason a recharging one already is not. The Sun Lion's maul hits
   * three times as hard as its claw and still loses.
   */
  it('keeps a once-a-day attack out of the default melee swing', () => {
    const best = bestPrintedMeleeAttack(sheetOf(SUN_LION));
    expect(best?.name).toBe('Claw');
  });
});

describe('a 2/Day Actions line', () => {
  it('is counted by the use, and the log says so', () => {
    const table = inTheWoods('dawn-herald', HERALD);
    table.did('the herald burns', (s) => takeStatedAction(s, HERALD, { line: SUNBURST }));

    expect(usedToday(table.state, HERALD)).toEqual({ [SUNBURST]: 1 });
    const used = ofType(table, 'printed-line-used-today');
    expect(used).toHaveLength(1);
    expect(used[0]?.type === 'printed-line-used-today' ? used[0].line : null).toBe(SUNBURST);
  });

  /** The rule reads the field, not the section: a line with no limit is free. */
  it('leaves a line the block prints no limit on uncounted', () => {
    const table = inTheWoods('dawn-herald', HERALD);
    table.did('the herald calls out', (s) => takeStatedAction(s, HERALD, { line: SHOUT }));

    expect(usedToday(table.state, HERALD)).toEqual({});
    expect(ofType(table, 'printed-line-used-today')).toEqual([]);
  });

  it('is taken twice, a turn apart, and counted twice', () => {
    const table = inTheWoods('dawn-herald', HERALD);
    table.did('the first burst', (s) => takeStatedAction(s, HERALD, { line: SUNBURST }));
    roundTrip(table);
    table.did('the second burst', (s) => takeStatedAction(s, HERALD, { line: SUNBURST }));

    expect(usedToday(table.state, HERALD)).toEqual({ [SUNBURST]: 2 });
    expect(ofType(table, 'printed-line-used-today')).toHaveLength(2);
  });

  /**
   * **The third is refused, and the Action is still there.** The refusal is
   * raised before the economy for the reason every other argument on this
   * command is: a refusal after the Action is gone is a refusal with a
   * footprint, and a creature that lost its turn to a rule that said no is a
   * creature the book never printed.
   */
  it('refuses a third use with nothing spent from the economy', () => {
    const table = inTheWoods('dawn-herald', HERALD);
    table.did('the first burst', (s) => takeStatedAction(s, HERALD, { line: SUNBURST }));
    roundTrip(table);
    table.did('the second burst', (s) => takeStatedAction(s, HERALD, { line: SUNBURST }));
    roundTrip(table);

    const third = takeStatedAction(table.state, HERALD, { line: SUNBURST });
    expect(isErr(third) ? third.code : 'ok').toBe('daily_limit_reached');
    expect(isErr(third) ? third.reason : '').toContain(SUNBURST);
    // It says the count it hit and the clock that clears it, because a caller
    // told only "no" cannot tell whether to wait a turn, rest, or camp.
    expect(isErr(third) ? third.reason : '').toContain('2');
    expect(isErr(third) ? third.reason : '').toContain('dawn');

    // No footprint: the Action is unspent, and another line still takes it.
    expect(table.state.combat?.budgets[HERALD]?.action).toBe(true);
    expect(usedToday(table.state, HERALD)).toEqual({ [SUNBURST]: 2 });
    expect(isErr(takeStatedAction(table.state, HERALD, { line: SHOUT }))).toBe(false);
  });
});

describe('a 1/Day Bonus Action line', () => {
  it('is counted by the use and refused the second time', () => {
    const table = inTheWoods('dawn-herald', HERALD);
    table.did('the herald steps', (s) => takeStatedBonusAction(s, HERALD, { line: DAWNSTEP }));
    expect(usedToday(table.state, HERALD)).toEqual({ [DAWNSTEP]: 1 });
    roundTrip(table);

    const again = takeStatedBonusAction(table.state, HERALD, { line: DAWNSTEP });
    expect(isErr(again) ? again.code : 'ok').toBe('daily_limit_reached');
    expect(isErr(again) ? again.reason : '').toContain(DAWNSTEP);
    expect(table.state.combat?.budgets[HERALD]?.bonusAction).toBe(true);

    // And the block's other Bonus Action line is untouched by the refusal.
    expect(isErr(takeStatedBonusAction(table.state, HERALD, { line: GLIMMER }))).toBe(false);
  });

  /** Two limited lines are two counts: spending one does not spend the other. */
  it('counts each heading on its own', () => {
    const table = inTheWoods('dawn-herald', HERALD);
    table.did('the herald steps', (s) => takeStatedBonusAction(s, HERALD, { line: DAWNSTEP }));
    table.did('the herald burns', (s) => takeStatedAction(s, HERALD, { line: SUNBURST }));

    expect(usedToday(table.state, HERALD)).toEqual({ [DAWNSTEP]: 1, [SUNBURST]: 1 });
  });
});

/**
 * The clock, which is the whole of what makes this a different rule.
 *
 * SRD prints *N/Day*, the owner has ruled that a day turns at **dawn**, and
 * the engine's `Recovery` vocabulary already keeps `dawn` apart from
 * `short-rest` and `long-rest` — a distinction the recharge rule leans on in
 * one direction ("Dawn is not a rest") and this one leans on in the other.
 */
describe('the day that turns', () => {
  const spentTwice = (): Table => {
    const table = inTheWoods('dawn-herald', HERALD);
    table.did('the first burst', (s) => takeStatedAction(s, HERALD, { line: SUNBURST }));
    table.did('the herald steps', (s) => takeStatedBonusAction(s, HERALD, { line: DAWNSTEP }));
    expect(usedToday(table.state, HERALD)).toEqual({ [SUNBURST]: 1, [DAWNSTEP]: 1 });
    table.do('the fight ends', (s) => endCombat(s, { kind: 'surrender', side: 'party' }));
    return table;
  };

  it('brings every counted line back at dawn', () => {
    const table = spentTwice();
    table.do('the sun comes up', (s) => restoreResourcesOn(s, HERALD, 'dawn'));

    expect(usedToday(table.state, HERALD)).toEqual({});
  });

  /**
   * **And through the door the world takes.** `declareDawn` is a moment the GM
   * declares over everybody at once, and what it gives a creature back is the
   * `resources-restored` a rest already emits with the other tag on it — so
   * the rule rides the tag rather than a second event an emitter could forget.
   */
  it('brings it back through the sunrise the GM declares', () => {
    const table = spentTwice();
    // A dawn pool of its own, because `declareDawn` writes about a creature
    // that holds something a morning gives back.
    table.do('a charged relic', (s) =>
      declareResourcePool(s, HERALD, {
        key: 'relic:charges',
        label: 'Relic Charges',
        max: 3,
        recovers: 'dawn',
      }),
    );
    table.do('the sun comes up', (s) => declareDawn(s, supply()));

    expect(usedToday(table.state, HERALD)).toEqual({});
  });

  /**
   * **A Long Rest is not a dawn.** The recharge rule's line comes back on
   * either rest because SRD *Monsters* says so in the same sentence as the
   * die; the book says nothing of the kind about a per-day count, and an
   * afternoon nap that handed back a Celestial's once-a-day strike would be
   * the engine writing a rule.
   */
  it('does not bring it back on a Long Rest', () => {
    const table = spentTwice();
    table.do('the rest begins', (s) => beginRest(s, HERALD, 'long'));
    table.do('eight hours', (s) => advanceTime(s, 8 * 3600, 'the rest'));
    table.did('the rest ends', (s) => endRest(s, HERALD));

    expect(usedToday(table.state, HERALD)).toEqual({ [SUNBURST]: 1, [DAWNSTEP]: 1 });
  });

  it('does not bring it back on a Short Rest', () => {
    const table = spentTwice();
    table.do('the rest begins', (s) => beginRest(s, HERALD, 'short'));
    table.do('an hour', (s) => advanceTime(s, 3600, 'the rest'));
    table.did('the rest ends', (s) => endRest(s, HERALD));

    expect(usedToday(table.state, HERALD)).toEqual({ [SUNBURST]: 1, [DAWNSTEP]: 1 });
  });

  /** Nor on the tag a feature spells out for itself, which is neither clock. */
  it('does not bring it back on a special recovery', () => {
    const table = spentTwice();
    table.do('something else gives back', (s) => restoreResourcesOn(s, HERALD, 'special'));

    expect(usedToday(table.state, HERALD)).toEqual({ [SUNBURST]: 1, [DAWNSTEP]: 1 });
  });

  /**
   * **And the turn boundary throws no die at it.** A recharge is settled at
   * the start of the creature's turn with a 1d6 that is rolled and recorded;
   * a per-day count has no die, no threshold and nothing to settle there, so
   * a boundary that rolled for one would be inventing a rule and moving the
   * generator for it.
   */
  it('is untouched by a turn-start recharge roll', () => {
    const table = inTheWoods('dawn-herald', HERALD);
    table.did('the herald burns', (s) => takeStatedAction(s, HERALD, { line: SUNBURST }));
    roundTrip(table);
    roundTrip(table);

    expect(usedToday(table.state, HERALD)).toEqual({ [SUNBURST]: 1 });
    expect(ofType(table, 'roll-recorded')).toEqual([]);
    expect(ofType(table, 'printed-line-recharged')).toEqual([]);
    // And nothing was ever written to the recharge rule's own record.
    expect(table.state.creatures[HERALD]?.expendedLines).toEqual([]);
  });
});

describe('the log the rule writes', () => {
  /** A retry is not a second use, and not a second count. */
  it('counts a repeated command id once', () => {
    const table = inTheWoods('dawn-herald', HERALD);
    table.did('the herald burns', (s) =>
      takeStatedAction(s, HERALD, { line: SUNBURST, commandId: 'burst' }),
    );
    const retry = unwrap(
      takeStatedAction(table.state, HERALD, { line: SUNBURST, commandId: 'burst' }),
      'the retry',
    );

    expect(retry.events).toEqual([]);
    expect(retry.duplicate).toBe(true);
    expect(ofType(table, 'printed-line-used-today')).toHaveLength(1);
    expect(usedToday(table.state, HERALD)).toEqual({ [SUNBURST]: 1 });
  });

  it('folds to the same state twice', () => {
    const table = inTheWoods('dawn-herald', HERALD);
    table.did('the first burst', (s) => takeStatedAction(s, HERALD, { line: SUNBURST }));
    table.did('the herald steps', (s) => takeStatedBonusAction(s, HERALD, { line: DAWNSTEP }));
    roundTrip(table);
    table.did('the second burst', (s) => takeStatedAction(s, HERALD, { line: SUNBURST }));

    const log = [...table.events];
    expect(JSON.stringify(fold('sunrise', log))).toBe(JSON.stringify(fold('sunrise', log)));
    expect(usedToday(fold('sunrise', log), HERALD)).toEqual({ [SUNBURST]: 2, [DAWNSTEP]: 1 });
  });

  /**
   * **The counts serialise in one order however they were spent.** Two logs
   * that spent the same two lines in opposite orders fold to byte-identical
   * records, which is the same promise `expendedLines` keeps by being sorted.
   */
  it('serialises the counts in one order, whichever was spent first', () => {
    const burstFirst = inTheWoods('dawn-herald', HERALD);
    burstFirst.did('the burst', (s) => takeStatedAction(s, HERALD, { line: SUNBURST }));
    burstFirst.did('the step', (s) => takeStatedBonusAction(s, HERALD, { line: DAWNSTEP }));

    const stepFirst = inTheWoods('dawn-herald', HERALD);
    stepFirst.did('the step', (s) => takeStatedBonusAction(s, HERALD, { line: DAWNSTEP }));
    stepFirst.did('the burst', (s) => takeStatedAction(s, HERALD, { line: SUNBURST }));

    expect(JSON.stringify(usedToday(burstFirst.state, HERALD))).toBe(
      JSON.stringify(usedToday(stepFirst.state, HERALD)),
    );
  });

  /** The same seed and the same script write the same log. */
  it('replays byte-identically from its seed', () => {
    const run = () => {
      const table = inTheWoods('dawn-herald', HERALD);
      table.did('the first burst', (s) => takeStatedAction(s, HERALD, { line: SUNBURST }));
      roundTrip(table, 'seed');
      table.did('the second burst', (s) => takeStatedAction(s, HERALD, { line: SUNBURST }));
      roundTrip(table, 'seed');
      return JSON.stringify(table.events);
    };
    expect(run()).toBe(run());
  });
});
