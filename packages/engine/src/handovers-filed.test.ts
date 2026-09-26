/**
 * **The filed handovers, at the doors that reach them** — W7-B13.
 *
 * A stat block's sentence goes out in one of two ways. The residue a reader
 * did not read is **owed**: it comes back in `unverified` in words that carry
 * no mark, and the ledger counts it. A sentence somebody read and filed as the
 * table's for good — fiction no rule reads afterwards — goes out under the
 * engine's handover mark (`DM_DECIDES`), in the book's own words, and the
 * ledger counts it as finished. These drive each filing through the door that
 * reaches it and assert which way it went out.
 *
 * And two of Part 4's rules beside them: a line whose saving throw the engine
 * reads is refused by the door that hands a sentence over, and sent to the
 * door that rolls it; and a line that reaches one creature at a distance is
 * measured, refused out of reach before anything is spent, and says nothing
 * about an area it did not have.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, type Result, expect as unwrap } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  forcePrintedSave,
  placeCreatureInScene,
  resolveAttack,
  setScene,
  takeStatedAction,
  takeStatedBonusAction,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { DM_DECIDES, dmDecisionsIn } from './spell-definitions.js';

const id = (s: string) => asCharacterId(s);
const MONSTER = id('monster');
const TOUGH = id('tough');
const FAR = id('far');

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const SEEDS = 'abcdefghijklmnopqrstuvwxyz'.split('').flatMap((a) => [a, `${a}2`, `${a}3`]);
const seedWhere = (pick: (seed: string) => boolean): string => {
  for (const seed of SEEDS) if (pick(seed)) return seed;
  throw new Error('no seed in the list took the branch this test is about');
};

class Table {
  readonly log: GameEvent[] = [];
  get state(): GameState {
    return fold('filed', this.log);
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
 * One monster at a brazier, a tough `near` feet off and another five feet
 * further. Five is a Medium monster's reach; a Large one's space is wider, so
 * its tests stand the tough a square further out.
 */
const aRoom = (slug: string, near = 5): Table => {
  const table = new Table();
  table.did('the monster', (s) => addCreature(s, SRD_CONTENT, MONSTER, slug));
  table.did('a tough', (s) => addCreature(s, SRD_CONTENT, TOUGH, 'tough'));
  table.did('another', (s) => addCreature(s, SRD_CONTENT, FAR, 'tough'));
  table.do('the room', (s) => setScene(s, { width: 120, depth: 120, height: 20 }));
  table.do('the brazier', (s) => addSceneLandmark(s, 'the brazier', { x: 60, y: 60, z: 0 }));
  table.do('the monster placed', (s) =>
    placeCreatureInScene(s, MONSTER, {
      from: { landmark: 'the brazier' },
      feet: 0,
    }),
  );
  table.do('the tough placed', (s) =>
    placeCreatureInScene(s, TOUGH, {
      from: { creature: MONSTER },
      feet: near,
      bearing: 90,
    }),
  );
  table.do('the other placed', (s) =>
    placeCreatureInScene(s, FAR, {
      from: { creature: MONSTER },
      feet: near + 5,
      bearing: 270,
    }),
  );
  for (const who of [TOUGH, FAR])
    table.do(`${who}'s side`, (s) => declareCreatureSide(s, who, 'party'));
  table.do("the monster's side", (s) => declareCreatureSide(s, MONSTER, 'wild'));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: MONSTER, initiative: 20, speed: 30 },
      { id: TOUGH, initiative: 10, speed: 30 },
      { id: FAR, initiative: 5, speed: 30 },
    ]),
  );
  return table;
};

const marked = (unverified: readonly string[]): readonly string[] => dmDecisionsIn(unverified);
const owed = (unverified: readonly string[]): readonly string[] =>
  unverified.filter((line) => !line.includes(DM_DECIDES));

describe('a filed sentence goes out under the handover mark, and never as owed', () => {
  it("files the basilisk's mirror at the moment of use, once", () => {
    const table = aRoom('basilisk');
    const out = unwrap(
      forcePrintedSave(
        table.state,
        MONSTER,
        { line: 'Petrifying Gaze (Recharge 4–6)', targets: [TOUGH, FAR] },
        supply('a'),
      ),
      'the gaze',
    );
    expect(marked(out.unverified)).toEqual([
      'If the basilisk sees its reflection in the Cone, the basilisk must make this save.',
    ]);
    expect(owed(out.unverified).join(' ')).not.toContain('reflection');
  });

  it("files the steam mephit's water at the moment of use", () => {
    const table = aRoom('steam-mephit');
    const out = unwrap(
      forcePrintedSave(
        table.state,
        MONSTER,
        { line: 'Steam Breath (Recharge 6)', targets: [TOUGH] },
        supply('a'),
      ),
      'the breath',
    );
    expect(marked(out.unverified)).toEqual([
      "Being underwater doesn't grant Resistance to this Fire damage.",
    ]);
    expect(owed(out.unverified).join(' ')).not.toContain('underwater');
  });

  it("files the wight's zombie and its twelve on a failure, and the engine rolls the rest", () => {
    const drain = (seed: string) =>
      forcePrintedSave(
        aRoom('wight').state,
        MONSTER,
        { line: 'Life Drain', targets: [TOUGH] },
        supply(seed),
      );
    const seed = seedWhere((s) => {
      const out = drain(s);
      return out.ok && out.value.outcomes[0]?.save?.success === false;
    });
    const before = aRoom('wight').state;
    const out = unwrap(drain(seed), 'the drain');
    // The engine's half: a Constitution save at DC 13, the damage, the maximum.
    const rolled = out.events.find(
      (e): e is Extract<GameEvent, { type: 'roll-recorded' }> =>
        e.type === 'roll-recorded' && e.label === 'Constitution save vs Life Drain',
    );
    expect(rolled).toBeDefined();
    expect(out.outcomes[0]!.damage).toBeGreaterThan(0);
    const after = out.events.reduce(applyEvent, before);
    expect(after.creatures[TOUGH]!.vitals.hpMax).toBe(
      before.creatures[TOUGH]!.vitals.hpMax - out.outcomes[0]!.damage,
    );
    // The table's half, under the mark.
    expect(marked(out.unverified)).toEqual([
      "A Humanoid slain by this attack rises 24 hours later as a **Zombie** under the wight's control, unless the Humanoid is restored to life or its body is destroyed.",
      'The wight can have no more than twelve zombies under its control at a time.',
    ]);
    // **A reach measured is not an area**: one creature within 5 feet, both
    // placed, so there is no "measured no area" line to hand over.
    expect(out.unverified.join(' ')).not.toContain('measured no area');
    expect(owed(out.unverified)).toEqual([]);
  });

  it('refuses a Life Drain at ten feet out of reach, with nothing spent', () => {
    const table = aRoom('wight');
    const refused = forcePrintedSave(
      table.state,
      MONSTER,
      { line: 'Life Drain', targets: [FAR] },
      supply('a'),
    );
    expect(isErr(refused) && refused.code).toBe('out_of_reach');
    expect(table.state.combat!.budgets[MONSTER]!.action).toBe(true);
  });

  it.each([
    [
      'salamander',
      'Flame Spear',
      "_Hit or Miss:_ The spear magically returns to the salamander's hand immediately after a ranged attack.",
    ],
    [
      'shadow',
      'Draining Swipe',
      'If a Humanoid is slain by this attack, a **Shadow** rises from the corpse 1d4 hours later.',
    ],
    [
      'gibbering-mouther',
      'Bite',
      'Its body is then absorbed into the mouther, leaving only equipment behind.',
    ],
  ] as const)("files the %s's %s sentence at the hit", (slug, line, sentence) => {
    const near = slug === 'salamander' ? 10 : 5;
    const swing = (seed: string) =>
      resolveAttack(
        aRoom(slug, near).state,
        MONSTER,
        { target: TOUGH, weapon: null, action: line },
        supply(seed),
      );
    const seed = seedWhere((s) => {
      const out = swing(s);
      return out.ok && out.value.attack?.hit === true;
    });
    const out = unwrap(swing(seed), line);
    expect(marked(out.unverified)).toEqual([sentence]);
    expect(owed(out.unverified).join(' ')).not.toContain(sentence);
  });

  it("files the rust monster's Destroy Metal whole, taken through the door that spends a line", () => {
    const out = unwrap(
      takeStatedAction(aRoom('rust-monster').state, MONSTER, {
        line: 'Destroy Metal',
      }),
      'Destroy Metal',
    );
    expect(out.events.some((event) => event.type === 'action-spent')).toBe(true);
    expect(marked(out.unverified)).toEqual([
      "The rust monster touches a nonmagical metal object within 5 feet of itself that isn't being worn or carried.",
      'The touch destroys a 1-foot Cube of the object.',
    ]);
    expect(owed(out.unverified)).toEqual([]);
  });

  it("says nothing of a swarm's two space clauses at its arrival, which are filed kinds", () => {
    const arrived = unwrap(
      addCreature(fold('swarm', []), SRD_CONTENT, MONSTER, 'swarm-of-rats'),
      'the rats',
    );
    expect(arrived.unverified.join(' ')).not.toContain("another creature's space");
    expect(arrived.unverified.join(' ')).not.toContain('opening large enough');
  });
});

describe('a line the engine reads is refused by the door that hands a sentence over', () => {
  it('sends the Life Drain to the door that rolls it, with nothing spent', () => {
    const table = aRoom('wight');
    const refused = takeStatedAction(table.state, MONSTER, {
      line: 'Life Drain',
    });
    expect(isErr(refused) && refused.code).toBe('line_has_its_own_door');
    expect(isErr(refused) && refused.reason).toContain('forcePrintedSave');
    expect(table.state.combat!.budgets[MONSTER]!.action).toBe(true);
  });

  it("sends a Bonus Action save the same way — the basilisk's gaze", () => {
    const refused = takeStatedBonusAction(aRoom('basilisk').state, MONSTER, {
      line: 'Petrifying Gaze (Recharge 4–6)',
    });
    expect(isErr(refused) && refused.code).toBe('line_has_its_own_door');
  });

  it("still takes a line the door itself applies — the seahorse's Bubble Dash", () => {
    const out = takeStatedAction(aRoom('seahorse').state, MONSTER, {
      line: 'Bubble Dash',
    });
    expect(isErr(out)).toBe(false);
  });

  it('still takes a line nothing was read beneath — the ghost is not the only prose left', () => {
    // SRD Will-o'-Wisp's Vanish is a Bonus Action the parser read nothing of.
    const out = takeStatedBonusAction(aRoom('will-o-wisp').state, MONSTER, {
      line: 'Vanish',
    });
    expect(isErr(out)).toBe(false);
  });
});
