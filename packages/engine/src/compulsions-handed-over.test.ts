/**
 * **The compulsions, handed over** — W7-B13.
 *
 * The owner ruled on 2026-09-24 that a compulsion is legality the table
 * adjudicates, and so a handover. Five stat-block shapes at CR ≤ 5 are
 * compulsions, and each is half the engine's and half the table's: the
 * saving throw, the recharge, the die and the day's grace are numbers and
 * deadlines the engine owns; who drives a body, which way a charmed creature
 * walks, what a d8's row means for a creature somebody is playing, what a
 * berserk golem attacks and what a lycanthrope's victim becomes are the
 * table's. These drive both halves through the doors a table uses and assert
 * the split: the engine's half happens, and the table's half comes back under
 * the engine's handover mark (`DM_DECIDES`), in the book's own words — never
 * in the residue a debt goes out in.
 *
 * **No face is asserted.** Each test that depends on a die searches a short
 * list of seeds for the branch it is about and asserts the rule on it, the
 * reading every test of this family takes.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, type CharacterId, isErr, type Result, expect as unwrap } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  declareSightBetween,
  forcePrintedSave,
  placeCreatureInScene,
  resolveAttack,
  resolvePendingSaves,
  resolveTurn,
  setScene,
  takePrintedForm,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { DM_DECIDES, dmDecisionsIn } from './spell-definitions.js';
import { printedLineSource } from './monster.js';
import { canSee } from './standing.js';

const id = (s: string) => asCharacterId(s);
const MONSTER = id('monster');
const TOUGH = id('tough');
const FAR = id('far');
const WOLF = id('wolf');
const VILLAGER = id('villager');
const NEIGHBOUR = id('neighbour');
const PIP = id('pip');

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const SEEDS = 'abcdefghijklmnopqrstuvwxyz'.split('').flatMap((a) => [a, `${a}2`, `${a}3`]);

/** The first seed on which `pick` holds, so a test asserts the rule on its branch. */
const seedWhere = (pick: (seed: string) => boolean): string => {
  for (const seed of SEEDS) if (pick(seed)) return seed;
  throw new Error('no seed in the list took the branch this test is about');
};

const pip = (): CharacterChoices => ({
  name: 'Pip',
  classId: 'fighter',
  level: 1,
  speciesId: 'halfling',
  backgroundId: 'soldier',
  languages: ['Halfling', 'Orc'],
  alignment: 'Neutral Good',
  spellbook: [],
  backgroundEquipment: 'A',
  classEquipment: 'A',
  hitPoints: { method: 'fixed' },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  cantrips: [],
  preparedSpells: [],
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, str: 1 },
  classSkills: ['athletics', 'survival'],
  equipped: ['chain-mail'],
  featureChoices: { 'fighter:weapon-mastery': [] },
  feats: {
    'soldier:savage-attacker': { featId: 'savage-attacker' },
    'fighter:fighting-style': { featId: 'defense' },
  },
});

class Table {
  readonly log: GameEvent[] = [];

  get state(): GameState {
    return fold('compulsions', this.log);
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

/**
 * One monster at a brazier and whoever the test names around it, at the
 * distances named, in an order that starts with the monster.
 */
const aRoom = (
  slug: string,
  others: readonly (readonly [CharacterId, string | 'pip', number])[],
): Table => {
  const table = new Table();
  table.did('the monster', (s) => addCreature(s, SRD_CONTENT, MONSTER, slug));
  for (const [who, block] of others) {
    if (block === 'pip') table.do('Pip', () => createCharacter(SRD_CONTENT, pip(), who));
    else table.did(who, (s) => addCreature(s, SRD_CONTENT, who, block));
  }
  table.do('the room', (s) => setScene(s, { width: 400, depth: 400, height: 20 }));
  table.do('the brazier', (s) => addSceneLandmark(s, 'the brazier', { x: 200, y: 200, z: 0 }));
  table.do('the monster placed', (s) =>
    placeCreatureInScene(s, MONSTER, {
      from: { landmark: 'the brazier' },
      feet: 0,
    }),
  );
  others.forEach(([who, , feet], at) => {
    table.do(`${who} placed`, (s) =>
      placeCreatureInScene(s, who, {
        from: { creature: MONSTER },
        feet,
        bearing: at * 60,
      }),
    );
    table.do(`${who}'s side`, (s) => declareCreatureSide(s, who, 'party'));
  });
  table.do("the monster's side", (s) => declareCreatureSide(s, MONSTER, 'wild'));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: MONSTER, initiative: 20, speed: 30 },
      ...others.map(([who], at) => ({
        id: who,
        initiative: 10 - at,
        speed: 30,
      })),
    ]),
  );
  return table;
};

/** The handed-over sentences a call reported, in the book's own words. */
const handedOverIn = (unverified: readonly string[]): readonly string[] =>
  dmDecisionsIn(unverified);

/** The lines a call reported that carry no mark: what the engine still owes. */
const owedIn = (unverified: readonly string[]): readonly string[] =>
  unverified.filter((line) => !line.includes(DM_DECIDES));

const savedAgainst = (
  events: readonly GameEvent[],
  who: CharacterId,
  line: string,
): boolean | null => {
  for (const event of events) {
    if (event.type === 'roll-recorded' && event.who === who && event.label.endsWith(`vs ${line}`)) {
      return event.outcome === 'resisted';
    }
  }
  return null;
};

// — the ghost ————————————————————————————————————————————————————————————————

describe("the ghost's Possession: the save and the day's grace are the engine's, the body is the table's", () => {
  const LINE = 'Possession (Recharge 6)';
  const haunted = () =>
    aRoom('ghost', [
      [TOUGH, 'tough', 5],
      [FAR, 'tough', 10],
      [WOLF, 'wolf', 5],
    ]);

  const possess = (seed: string, target: CharacterId = TOUGH) => {
    const table = haunted();
    const before = table.state;
    const out = forcePrintedSave(
      before,
      MONSTER,
      { line: LINE, targets: [target], commandId: `p-${seed}` },
      supply(seed),
    );
    return { before, out };
  };

  it('rolls the Charisma save and spends the recharge, and hands the body over on a failure', () => {
    const seed = seedWhere((s) => {
      const { out } = possess(s);
      return out.ok && savedAgainst(out.value.events, TOUGH, LINE) === false;
    });
    const { before, out } = possess(seed);
    const done = unwrap(out, 'possession');

    // The engine's half: a Charisma save at the printed DC, and the heading's
    // recharge spent.
    const save = done.outcomes[0]?.save;
    expect(save?.success).toBe(false);
    expect(done.events.some((e) => e.type === 'printed-line-expended' && e.line === LINE)).toBe(
      true,
    );
    expect(
      done.events.some((e) => e.type === 'roll-recorded' && e.label === `Charisma save vs ${LINE}`),
    ).toBe(true);
    const state = done.events.reduce(applyEvent, before);
    // **The possession is the engine's facts now** (M-MIND): the ghost is
    // inside the body and the body is Incapacitated. `ghost-possession.test.ts`
    // drives the rest of it.
    expect(state.creatures[TOUGH]!.conditions.conditions).toEqual(['incapacitated']);
    expect(state.creatures[MONSTER]!.elsewhere).toMatchObject({ kind: 'inside', host: TOUGH });

    // The table's half — who drives the body — under the mark and in the
    // book's words.
    const filed = handedOverIn(done.unverified);
    expect(filed).toEqual([
      'The ghost now controls the body, but the target retains awareness.',
      "The ghost's game statistics are the same, except it uses the possessed target's Speed, as well as the target's Strength, Dexterity, and Constitution modifiers.",
    ]);
    // The ending is the engine's now, and the one sentence still owed is the
    // exception to "can't be targeted" — said, unmarked, as a debt.
    const owed = owedIn(done.unverified).join(' ');
    expect(owed).not.toContain('When the possession ends');
    expect(owed).toContain('except ones that specifically target Undead');
  });

  it("keeps a day's grace on a success, and the next Possession passes the target by", () => {
    const seed = seedWhere((s) => {
      const { out } = possess(s);
      return out.ok && savedAgainst(out.value.events, TOUGH, LINE) === true;
    });
    const { before, out } = possess(seed);
    const done = unwrap(out, 'possession');
    const state = done.events.reduce(applyEvent, before);
    expect(state.creatures[TOUGH]!.lineImmunities.map((one) => one.source)).toEqual([
      printedLineSource(MONSTER, LINE),
    ]);
    // Nothing of the failure's is reported on a success.
    expect(handedOverIn(done.unverified)).toEqual([]);
  });

  it('refuses a creature that is not a Humanoid, and one out of reach, before anything is spent', () => {
    const table = haunted();
    const wolf = forcePrintedSave(
      table.state,
      MONSTER,
      { line: LINE, targets: [WOLF] },
      supply('a'),
    );
    expect(isErr(wolf) && wolf.code).toBe('target_not_eligible');
    const far = forcePrintedSave(table.state, MONSTER, { line: LINE, targets: [FAR] }, supply('a'));
    expect(isErr(far) && far.code).toBe('out_of_reach');
    // "one Humanoid": a second one named is a call that is wrong.
    const two = forcePrintedSave(
      table.state,
      MONSTER,
      { line: LINE, targets: [TOUGH, FAR] },
      supply('a'),
    );
    expect(isErr(two) && two.code).toBe('too_many_targets');
    // Nothing spent: the recharge is still there to use.
    expect(table.state.creatures[MONSTER]!.expendedLines).toEqual([]);
  });

  it('refuses a Humanoid the ghost cannot see, and sees with its own Darkvision where nobody has declared it', () => {
    // "one Humanoid **the ghost can see**": where the engine's answer is no,
    // the line is refused before anything is spent — the casting door's
    // reading — and where nobody has said, the ghost's printed Darkvision 60
    // answers for the Humanoid five feet off (W8-S25), so the line is rolled
    // with nothing about the sight left owed. Where no sense of the looker
    // reaches, the sight is still reported: `printed-save-effects.test.ts`'s
    // Satyr holds that half.
    const table = haunted();
    table.do('the ghost cannot see the tough', (s) => declareSightBetween(s, MONSTER, TOUGH, false));
    const unseen = forcePrintedSave(table.state, MONSTER, { line: LINE, targets: [TOUGH] }, supply('a'));
    expect(isErr(unseen) && unseen.code).toBe('cannot_see_target');
    expect(table.state.creatures[MONSTER]!.expendedLines).toEqual([]);

    const undeclared = unwrap(
      forcePrintedSave(haunted().state, MONSTER, { line: LINE, targets: [TOUGH] }, supply('a')),
      'possession',
    );
    expect(canSee(haunted().state, MONSTER, TOUGH)).toBe(true);
    expect(owedIn(undeclared.unverified).join(' ')).not.toContain('nobody has said whether it can see');
  });
});

// — the harpy ——————————————————————————————————————————————————————————————————

describe("the harpy's Luring Song: the Charm and its repeat are the engine's, the walk is the table's", () => {
  const LINE = 'Luring Song';
  const singing = () =>
    aRoom('harpy', [
      [VILLAGER, 'commoner', 60],
      [NEIGHBOUR, 'commoner', 90],
      [WOLF, 'wolf', 30],
    ]);

  const sing = (seed: string) => {
    const table = singing();
    const before = table.state;
    const out = forcePrintedSave(
      before,
      MONSTER,
      { line: LINE, targets: [VILLAGER, NEIGHBOUR], commandId: `s-${seed}` },
      supply(seed),
    );
    return { table, before, out };
  };

  it('Charms two villagers who fail, Incapacitates them while Charmed, and hands the walk over', () => {
    const seed = seedWhere((s) => {
      const { out } = sing(s);
      return (
        out.ok &&
        savedAgainst(out.value.events, VILLAGER, LINE) === false &&
        savedAgainst(out.value.events, NEIGHBOUR, LINE) === false
      );
    });
    const { table, before, out } = sing(seed);
    const done = unwrap(out, 'the song');
    table.log.push(...done.events);
    const state = done.events.reduce(applyEvent, before);
    for (const who of [VILLAGER, NEIGHBOUR]) {
      expect([...state.creatures[who]!.conditions.conditions].sort(), who).toEqual([
        'charmed',
        'incapacitated',
      ]);
    }

    // The walk and the Opportunity Attacks are the table's, once per creature
    // the song caught.
    const filed = handedOverIn(done.unverified);
    expect(filed.filter((one) => one.startsWith('If the target is more than 5 feet'))).toHaveLength(
      2,
    );
    expect(filed.filter((one) => one === "It doesn't avoid Opportunity Attacks.")).toHaveLength(2);
    // The song's Concentration and the repeats a blow or lava raise are owed,
    // and said without the mark.
    const owed = owedIn(done.unverified).join(' ');
    expect(owed).toContain("until the harpy's Concentration ends on it");
    expect(owed).toContain('damaging terrain');

    // **The repeat is the engine's**: the end of a charmed villager's turn owes
    // the save against the song.
    table.did('the harpy finishes', (s) => resolveTurn(s));
    const villagersEnd = table.did('the villager finishes', (s) => resolveTurn(s));
    expect(
      Object.values(villagersEnd.pendingSaves).some((pending) => pending.target === VILLAGER),
    ).toBe(true);
  });

  it('refuses a Beast, which the song does not reach', () => {
    const table = singing();
    const refused = forcePrintedSave(
      table.state,
      MONSTER,
      { line: LINE, targets: [WOLF] },
      supply('a'),
    );
    expect(isErr(refused) && refused.code).toBe('target_not_eligible');
  });
});

// — the gibbering mouther ———————————————————————————————————————————————————————

describe("the mouther's Gibbering: the d8 is the engine's, the row it lands on is the table's", () => {
  const babbled = (seed: string) => {
    const table = aRoom('gibbering-mouther', [[TOUGH, 'tough', 10]]);
    const toughsTurn = table.did('the mouther finishes', (s) => resolveTurn(s));
    return unwrap(resolvePendingSaves(toughsTurn, supply(seed)), 'the babbling');
  };

  it('throws a d8 on a failed save and reports the face beside the row it indexes', () => {
    const seed = seedWhere((s) => babbled(s).saves[0]?.success === false);
    const rolled = babbled(seed);
    const thrown = rolled.events.find(
      (event): event is Extract<GameEvent, { type: 'roll-recorded' }> =>
        event.type === 'roll-recorded' && event.label.includes('(1d8)'),
    );
    expect(thrown).toBeDefined();
    const face = thrown!.natural;
    expect(face).toBeGreaterThanOrEqual(1);
    expect(face).toBeLessThanOrEqual(8);
    const row =
      face <= 4
        ? 'The target does nothing.'
        : face <= 6
          ? 'The target takes no action or Bonus Action and uses all its movement to move in a random direction.'
          : "The target makes a melee attack against a randomly determined creature within its reach or does nothing if it can't make such an attack.";
    // Exactly the row the face indexes, and the face beside it.
    expect(handedOverIn(rolled.unverified)).toEqual([row]);
    expect(rolled.unverified.find((line) => line.includes(DM_DECIDES))).toContain(`showed ${face}`);
    // Nothing of the table is owed any more.
    expect(owedIn(rolled.unverified).join(' ')).not.toContain('rolls 1d8');
  });

  it('throws no d8 on a made save', () => {
    const seed = seedWhere((s) => babbled(s).saves[0]?.success === true);
    const rolled = babbled(seed);
    expect(
      rolled.events.some(
        (event) => event.type === 'roll-recorded' && event.label.includes('(1d8)'),
      ),
    ).toBe(false);
    expect(handedOverIn(rolled.unverified)).toEqual([]);
  });
});

// — the flesh golem ————————————————————————————————————————————————————————————

describe("the flesh golem's Berserk: a d6 at a Bloodied turn's start, and berserk on a 6 handed over", () => {
  /** The golem second in the order, so ending the first turn begins its own. */
  const golemRoom = (bloodied: boolean): Table => {
    const table = new Table();
    table.did('the golem', (s) => addCreature(s, SRD_CONTENT, MONSTER, 'flesh-golem'));
    table.did('the tough', (s) => addCreature(s, SRD_CONTENT, TOUGH, 'tough'));
    if (bloodied) {
      // Past half of a hundred and twenty-seven, stated rather than rolled: the
      // test is about the turn that starts Bloodied, not the blow.
      table.log.push({
        type: 'damage-taken',
        id: MONSTER,
        amount: 70,
        source: 'the fight before',
      });
    }
    table.do('the order', (s) =>
      beginCombat(s, [
        { id: TOUGH, initiative: 20, speed: 30 },
        { id: MONSTER, initiative: 10, speed: 30 },
      ]),
    );
    return table;
  };

  const golemsStart = (seed: string, bloodied = true) => {
    const table = golemRoom(bloodied);
    return unwrap(resolveTurn(table.state, supply(seed)), "the golem's turn begins");
  };

  const berserkDie = (events: readonly GameEvent[]) =>
    events.find(
      (event): event is Extract<GameEvent, { type: 'roll-recorded' }> =>
        event.type === 'roll-recorded' && event.who === MONSTER && event.label.includes('1d6'),
    );

  it('throws the d6 at a Bloodied start, and hands every berserk sentence over on a 6', () => {
    const seed = seedWhere((s) => berserkDie(golemsStart(s).events)?.natural === 6);
    const begun = golemsStart(seed);
    const filed = handedOverIn(begun.unverified);
    expect(filed).toHaveLength(2);
    expect(filed[0]).toMatch(
      /^On each of its turns while berserk, the golem attacks the nearest creature/,
    );
    expect(filed[1]).toMatch(/DC 15 Charisma \(Persuasion\) check/);
  });

  it('throws the d6 and hands nothing over below a 6', () => {
    const seed = seedWhere((s) => {
      const face = berserkDie(golemsStart(s).events)?.natural;
      return face !== undefined && face < 6;
    });
    const begun = golemsStart(seed);
    expect(berserkDie(begun.events)).toBeDefined();
    expect(handedOverIn(begun.unverified)).toEqual([]);
  });

  it('throws nothing at a start that is not Bloodied', () => {
    const begun = golemsStart('a', false);
    expect(berserkDie(begun.events)).toBeUndefined();
    expect(handedOverIn(begun.unverified)).toEqual([]);
  });

  it('refuses to advance past a Bloodied start with no generator to throw the die', () => {
    const dry = resolveTurn(golemRoom(true).state);
    expect(isErr(dry) && dry.code).toBe('trait_die_owed');
    // And with nothing owed, nothing is refused.
    expect(isErr(resolveTurn(golemRoom(false).state))).toBe(false);
  });
});

// — the lycanthrope's curse ————————————————————————————————————————————————————

describe("a werewolf's Bite: a save a Humanoid makes, a curse on the record, a day's grace", () => {
  const BITE = 'Bite (Wolf or Hybrid Form Only)';
  const SHIFT = SRD_CONTENT.monsterById('werewolf')!.bonusActions.find(
    (line) => line.forms !== undefined,
  )!.name;

  const bitten = (seed: string, target: CharacterId, block: string | 'pip') => {
    const table = aRoom('werewolf', [[target, block, 5]]);
    table.did('the wolf takes its shape', (s) =>
      takePrintedForm(s, MONSTER, { line: SHIFT, form: 'wolf' }),
    );
    const before = table.state;
    const out = resolveAttack(
      before,
      MONSTER,
      { target, weapon: null, action: BITE },
      supply(seed),
    );
    const events = out.ok ? out.value.events : [];
    return { before, out, events, state: events.reduce(applyEvent, before) };
  };

  it.each([
    ['a human tough', TOUGH, 'tough'],
    ['a halfling — a Humanoid by species', PIP, 'pip'],
  ] as const)(
    'curses %s on a failed Constitution save and hands the transformation over',
    (_, who, block) => {
      const seed = seedWhere(
        (s) => savedAgainst(bitten(s, who, block).events, who, BITE) === false,
      );
      const { out, state } = bitten(seed, who, block);
      const done = unwrap(out, 'the bite');
      expect(
        done.events.some(
          (e) => e.type === 'roll-recorded' && e.label === `Constitution save vs ${BITE}`,
        ),
      ).toBe(true);
      expect(state.creatures[who]!.curses).toEqual([
        { source: printedLineSource(MONSTER, BITE), by: MONSTER, line: BITE },
      ]);
      expect(handedOverIn(done.unverified)).toEqual([
        "If the cursed target drops to 0 Hit Points, it instead becomes a **Werewolf** under the GM's control and has 10 Hit Points.",
      ]);
      // **Read as a Humanoid, not rolled for want of knowing** — the type is
      // the creature's own record (the tough's block, the halfling's species),
      // so no "nobody has said what it is" note rides with the save.
      expect(state.creatures[who]!.creatureType).toBe('Humanoid');
      expect(done.unverified.join(' ')).not.toContain('nobody has said what');
    },
  );

  it.each([
    ['a human tough', TOUGH, 'tough'],
    ['a halfling', PIP, 'pip'],
  ] as const)(
    "grants %s a day's grace on a made save, and the next bite asks nothing",
    (_, who, block) => {
      const seed = seedWhere((s) => savedAgainst(bitten(s, who, block).events, who, BITE) === true);
      const { state, out } = bitten(seed, who, block);
      expect(state.creatures[who]!.curses).toEqual([]);
      // The grace is from the **curse**, filed beneath the line's own source:
      // the werewolf may go on biting, and the bite goes on landing.
      expect(state.creatures[who]!.lineImmunities).toEqual([
        {
          source: `${printedLineSource(MONSTER, BITE)}:curse`,
          by: MONSTER,
          line: `${BITE}'s curse`,
        },
      ]);
      expect(handedOverIn(unwrap(out, 'the bite').unverified)).toEqual([]);

      // A second bite that lands, on the werewolf's next turn, throws no save
      // against a creature immune to it.
      const round = unwrap(
        resolveTurn(state, supply('round')),
        "the werewolf's turn ends",
      ).events.reduce(applyEvent, state);
      const nextTurn = unwrap(
        resolveTurn(round, supply('round-2')),
        `${who}'s turn ends`,
      ).events.reduce(applyEvent, round);
      const bite = (s: string) =>
        resolveAttack(
          nextTurn,
          MONSTER,
          { target: who, weapon: null, action: BITE },
          supply(`again-${s}`),
        );
      const again = seedWhere((s) => {
        const next = bite(s);
        return next.ok && next.value.events.some((e) => e.type === 'damage-taken' && e.id === who);
      });
      const second = unwrap(bite(again), 'the second bite');
      expect(savedAgainst(second.events, who, BITE)).toBeNull();
      expect(second.unverified.join(' ')).toContain('was not asked to save');
    },
  );

  it('asks nothing of a wolf, which is not a Humanoid', () => {
    const seed = seedWhere((s) =>
      bitten(s, WOLF, 'wolf').events.some((e) => e.type === 'damage-taken' && e.id === WOLF),
    );
    const { events, state } = bitten(seed, WOLF, 'wolf');
    expect(savedAgainst(events, WOLF, BITE)).toBeNull();
    expect(state.creatures[WOLF]!.curses).toEqual([]);
  });
});
