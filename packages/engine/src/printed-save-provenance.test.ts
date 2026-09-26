import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, type CharacterId, type Result, expect as unwrap } from '@ie/shared';
import type { CharacterSheet } from './character.js';
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
  resolveSpell,
  resolveTurn,
  setScene,
} from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { printedLineHolder, printedLineSource } from './monster.js';
import { createRollIssuer } from './rolls.js';
import { declaredCasting } from './spellcasting.js';

/**
 * **A save a stat block forced, and what it knows about who forced it** — W8-S24.
 *
 * SRD Protection from Evil and Good: "The target also can't be possessed by or
 * gain the Charmed or Frightened conditions from them. If the target is already
 * possessed, Charmed, or Frightened by such a creature, the target has
 * Advantage on any new saving throw against the relevant effect."
 *
 * Both halves reached a creature that cast a spell and neither reached one that
 * used its own stat block: the repeat a printed line hangs — SRD Quasit's
 * Scare, "At the end of each of its turns, the target repeats the save" — named
 * its line and not its creature, and the condition a printed line lands named
 * nobody at all. And beside them the same silence on the other axis: the first
 * save a printed line forces said nothing about what it would impose, so SRD
 * Dwarven Resilience's "Advantage on saving throws you make to avoid or end the
 * Poisoned condition" reached every spell's Poison and no stat block's.
 *
 * **No face is asserted.** A test that needs a save failed searches a short
 * list of seeds for the branch and asserts the rule on it.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const ACOLYTE = id('acolyte');
const MONSTER = id('monster');
const PROTECTION = 'Protection from Evil and Good';

const SEEDS = 'abcdefghijklmnopqrstuvwxyz'.split('').flatMap((a) => [a, `${a}2`, `${a}3`]);

/** The first seed on which `pick` holds, so a test asserts the rule on its branch. */
const seedWhere = (pick: (seed: string) => boolean): string => {
  for (const seed of SEEDS) if (pick(seed)) return seed;
  throw new Error('no seed in the list took the branch this test is about');
};

const supply = (state: GameState, seed: string) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/**
 * A Humanoid with a poor Wisdom, so a DC 10 fright fails on more than half the
 * faces and a short seed list always finds one.
 */
const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 12, dex: 14, con: 12, int: 10, wis: 6, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple', 'martial'],
});

const person = (who: CharacterId): readonly GameEvent[] => [
  {
    type: 'creature-added',
    id: who,
    name: who,
    sheet: sheet(),
    maxHp: 200,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'party',
  },
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'cleric',
      prepared: ['protection-from-evil-and-good'],
    }),
  },
  {
    type: 'resource-pool-declared',
    id: who,
    pool: { key: 'spell-slot:1', label: 'level 1', max: 4, recovers: 'long-rest' },
  },
];

class Table {
  readonly log: GameEvent[] = [];

  get state(): GameState {
    return fold('provenance', this.log);
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

  /** Advance the order until it is this creature's turn, rolling whatever the boundaries owe. */
  until(who: CharacterId): this {
    for (let guard = 0; guard < 12; guard += 1) {
      const combat = this.state.combat;
      if (combat !== null && combat.order[combat.turnIndex]?.id === who) return this;
      this.did('turn', (s) => resolveTurn(s, supply(s, 'turns')));
    }
    throw new Error(`the order never reached ${who}`);
  }

  /** The acolyte wards the cleric, on the acolyte's own turn. */
  ward(): this {
    this.until(ACOLYTE);
    this.did('the ward', (s) =>
      resolveSpell(
        s,
        ACOLYTE,
        { spellId: 'protection-from-evil-and-good', targets: [CLERIC], willing: [CLERIC] },
        supply(s, 'ward'),
      ),
    );
    return this;
  }

  /** The monster spends a printed save line on the cleric, on its own turn. */
  force(line: string, seed: string, commandId?: string): readonly GameEvent[] {
    this.until(MONSTER);
    const out = unwrap(
      forcePrintedSave(
        this.state,
        MONSTER,
        { line, targets: [CLERIC], ...(commandId === undefined ? {} : { commandId }) },
        supply(this.state, seed),
      ),
      line,
    );
    this.log.push(...out.events);
    return out.events;
  }

  conditionsOnTheCleric(): readonly string[] {
    return (this.state.creatures[CLERIC]?.conditions.instances ?? []).map((one) => one.condition);
  }
}

/**
 * One monster, the cleric five feet from it and the acolyte beside her, in an
 * order that runs monster, acolyte, cleric: the ward goes up between the fright
 * and the end of the cleric's turn, which is the only way to be *already*
 * Frightened by such a creature when the ward arrives.
 */
const aRoom = (slug: string): Table => {
  const table = new Table();
  table.did('the monster', (s) => addCreature(s, SRD_CONTENT, MONSTER, slug));
  table.log.push(...person(CLERIC), ...person(ACOLYTE));
  table.do('the room', (s) => setScene(s, { width: 400, depth: 400, height: 20 }));
  table.do('the brazier', (s) => addSceneLandmark(s, 'the brazier', { x: 200, y: 200, z: 0 }));
  table.do('the monster placed', (s) =>
    placeCreatureInScene(s, MONSTER, { from: { landmark: 'the brazier' }, feet: 0 }),
  );
  table.do('the cleric placed', (s) =>
    placeCreatureInScene(s, CLERIC, { from: { creature: MONSTER }, feet: 5, bearing: 90 }),
  );
  table.do('the acolyte placed', (s) =>
    placeCreatureInScene(s, ACOLYTE, { from: { creature: CLERIC }, feet: 5, bearing: 90 }),
  );
  for (const [from, to] of [
    [MONSTER, CLERIC],
    [CLERIC, MONSTER],
    [MONSTER, ACOLYTE],
    [ACOLYTE, MONSTER],
  ] as const) {
    table.do(`${from} sees ${to}`, (s) => declareSightBetween(s, from, to, true));
  }
  table.do("the monster's side", (s) => declareCreatureSide(s, MONSTER, 'foes'));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: MONSTER, initiative: 20, speed: 30 },
      { id: ACOLYTE, initiative: 15, speed: 30 },
      { id: CLERIC, initiative: 10, speed: 30 },
    ]),
  );
  return table;
};

/** The saving throw the log recorded for the cleric against a line, with its modes. */
const saveAgainst = (
  events: readonly GameEvent[],
  line: string,
): { readonly failed: boolean; readonly modes: readonly string[]; readonly sources: string } | null => {
  for (const event of events) {
    if (event.type !== 'roll-recorded' || event.who !== CLERIC) continue;
    if (!event.label.endsWith(`vs ${line}`)) continue;
    return {
      failed: event.outcome === 'affected',
      modes: (event.modes ?? []).map((one) => one.mode),
      sources: (event.modes ?? []).map((one) => one.source).join(' '),
    };
  }
  return null;
};

/**
 * The repeat the end of the cleric's turn rolls, with the mode it came out
 * under and whom it named.
 */
const repeatAtTheClericsTurnEnd = (
  table: Table,
): { readonly mode: string; readonly label: string; readonly sources: string } => {
  table.until(CLERIC);
  const out = unwrap(resolveTurn(table.state, supply(table.state, 'repeat')), 'the cleric ends');
  table.log.push(...out.events);
  const mine = out.saves.filter((one) => one.target === CLERIC);
  if (mine.length !== 1) throw new Error(`the boundary rolled ${mine.length} saves for the cleric`);
  const save = mine[0]!;
  return {
    mode: save.save.mode,
    label: save.label,
    sources: save.save.modeSources.map((one) => one.source).join(' '),
  };
};

/**
 * A fright a line landed on an unwarded cleric: the first seed on which the
 * save fails, kept.
 */
const frightenedBy = (slug: string, line: string): Table => {
  const seed = seedWhere((s) => {
    const trial = aRoom(slug);
    return saveAgainst(trial.force(line, s), line)?.failed === true;
  });
  const table = aRoom(slug);
  table.force(line, seed);
  expect(table.conditionsOnTheCleric()).toContain('frightened');
  return table;
};

// — the repeat a printed line hangs ————————————————————————————————————————————

describe('the repeat a printed line hangs knows whose line it was', () => {
  it('gives a warded cleric Advantage on the repeat against a Fiend’s Scare', () => {
    const table = frightenedBy('quasit', 'Scare (1/Day)');
    table.ward();

    const repeat = repeatAtTheClericsTurnEnd(table);
    expect(repeat.label).toContain('Scare');
    expect(repeat.mode).toBe('advantage');
    expect(repeat.sources).toContain(PROTECTION);

    // And the log replays to the same state byte for byte, through JSON.
    const replayed = fold('provenance', JSON.parse(JSON.stringify(table.log)) as GameEvent[]);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(table.state));
  });

  it('leaves the repeat against a Monstrosity’s Unsettling Visage alone under the same ward', () => {
    const table = frightenedBy('doppelganger', 'Unsettling Visage (Recharge 6)');
    table.ward();

    const repeat = repeatAtTheClericsTurnEnd(table);
    expect(repeat.label).toContain('Unsettling Visage');
    expect(repeat.mode).toBe('normal');
  });

  it('gives an unwarded cleric nothing on the Fiend’s repeat', () => {
    const table = frightenedBy('quasit', 'Scare (1/Day)');
    expect(repeatAtTheClericsTurnEnd(table).mode).toBe('normal');
  });
});

// — the Immunity on the printed road ———————————————————————————————————————————

describe('a warded cleric cannot gain the condition from such a creature’s stat block', () => {
  it('rolls the Quasit’s Scare and refuses the Frightened a failure would land', () => {
    const line = 'Scare (1/Day)';
    const seed = seedWhere((s) => {
      const trial = aRoom('quasit').ward();
      return saveAgainst(trial.force(line, s), line)?.failed === true;
    });
    const table = aRoom('quasit').ward();
    const events = table.force(line, seed);
    // The save is rolled — the Immunity is about the condition, not the die.
    expect(saveAgainst(events, line)?.failed).toBe(true);
    expect(table.conditionsOnTheCleric()).not.toContain('frightened');
  });

  it('is Frightened by the Doppelganger’s Visage, a Monstrosity the ward does not name', () => {
    const line = 'Unsettling Visage (Recharge 6)';
    const seed = seedWhere((s) => {
      const trial = aRoom('doppelganger').ward();
      return saveAgainst(trial.force(line, s), line)?.failed === true;
    });
    const table = aRoom('doppelganger').ward();
    table.force(line, seed);
    expect(table.conditionsOnTheCleric()).toContain('frightened');
  });

  it('is not Charmed by a Sprite’s Enchanting Bow, and an unwarded cleric is', () => {
    const shoot = (warded: boolean, seed: string): Table => {
      const table = aRoom('sprite');
      if (warded) table.ward();
      table.until(MONSTER);
      table.did('the bow', (s) =>
        resolveAttack(
          s,
          MONSTER,
          { target: CLERIC, weapon: null, action: 'Enchanting Bow' },
          supply(s, seed),
        ),
      );
      return table;
    };
    // The bow deals a flat 1, so no dice are recorded: the hit is the damage.
    const hit = (table: Table): boolean =>
      table.log.some((event) => event.type === 'damage-taken' && event.id === CLERIC);

    const bare = shoot(false, seedWhere((s) => hit(shoot(false, s))));
    expect(bare.conditionsOnTheCleric()).toContain('charmed');

    const warded = shoot(true, seedWhere((s) => hit(shoot(true, s))));
    expect(hit(warded)).toBe(true);
    expect(warded.conditionsOnTheCleric()).not.toContain('charmed');
  });
});

/**
 * **The other doors a stat block's hit lands a condition through**, which
 * carry no Charmed or Frightened in the SRD and so are driven with a narrowed
 * Immunity stated directly — the same `fromTypes` Protection from Evil and Good
 * writes, over the condition each door lands. What is asserted is that each
 * door says who is causing its condition: the type the Immunity names is
 * refused, and a type it does not name is not.
 */
describe('every door a printed hit lands a condition through names its causer', () => {
  const TARGET = id('target');

  const struck = (
    slug: string,
    line: string,
    immunity: { readonly conditions: readonly ('grappled' | 'blinded' | 'poisoned')[]; readonly fromTypes: readonly string[] },
    seed: string,
    options: { readonly advantage?: boolean; readonly hitPoints?: number } = {},
  ): Table => {
    const table = new Table();
    table.did('the monster', (s) => addCreature(s, SRD_CONTENT, MONSTER, slug));
    table.log.push(
      {
        type: 'creature-added',
        id: TARGET,
        name: TARGET,
        sheet: sheet(),
        maxHp: options.hitPoints ?? 200,
        diesAtZero: false,
        creatureType: 'Humanoid',
        side: 'party',
      },
      {
        type: 'condition-immunity-granted',
        id: TARGET,
        immunity: { source: 'a stated ward', conditions: [...immunity.conditions], fromTypes: [...immunity.fromTypes] },
      },
    );
    table.do('the order', (s) =>
      beginCombat(s, [
        { id: MONSTER, initiative: 20, speed: 30 },
        { id: TARGET, initiative: 10, speed: 30 },
      ]),
    );
    table.did(line, (s) =>
      resolveAttack(
        s,
        MONSTER,
        {
          target: TARGET,
          weapon: null,
          action: line,
          ...(options.advantage === true ? { modes: ['advantage' as const] } : {}),
        },
        supply(s, seed),
      ),
    );
    return table;
  };
  const hit = (table: Table): boolean =>
    table.log.some((event) => event.type === 'damage-taken' && event.id === TARGET);
  const held = (table: Table): readonly string[] =>
    (table.state.creatures[TARGET]?.conditions.instances ?? []).map((one) => one.condition);

  const both = (
    slug: string,
    line: string,
    condition: 'grappled' | 'blinded' | 'poisoned',
    itsType: string,
    options: { readonly advantage?: boolean; readonly hitPoints?: number } = {},
  ): { readonly refused: readonly string[]; readonly admitted: readonly string[] } => {
    const against = (fromTypes: readonly string[]) => {
      const seed = seedWhere((s) => hit(struck(slug, line, { conditions: [condition], fromTypes }, s, options)));
      return held(struck(slug, line, { conditions: [condition], fromTypes }, seed, options));
    };
    return { refused: against([itsType]), admitted: against(['Celestial']) };
  };

  it('the grapple a Crocodile’s Bite makes', () => {
    const { refused, admitted } = both('crocodile', 'Bite', 'grappled', 'Beast');
    expect(admitted).toContain('grappled');
    expect(refused).not.toContain('grappled');
  });

  it('the Blinded a Darkmantle’s Crush leaves while it is attached', () => {
    const { refused, admitted } = both('darkmantle', 'Crush', 'blinded', 'Aberration', {
      advantage: true,
    });
    expect(admitted).toContain('blinded');
    expect(refused).not.toContain('blinded');
  });

  it('the Poisoned a Phase Spider’s Bite leaves on a creature it dropped', () => {
    const { refused, admitted } = both('phase-spider', 'Bite', 'poisoned', 'Monstrosity', {
      hitPoints: 1,
    });
    expect(admitted).toContain('poisoned');
    expect(refused).not.toContain('poisoned');
  });
});

// — "already … by such a creature" on a new save ————————————————————————————————

describe('a new save against a line the target is already under', () => {
  const GLARE = 'Dreadful Glare';

  it('is rolled with Advantage where the Mummy has already frightened the warded cleric', () => {
    const table = frightenedBy('mummy', GLARE);
    table.ward();
    // "Until the end of the mummy's next turn": still Frightened when it glares again.
    table.until(MONSTER);
    expect(table.conditionsOnTheCleric()).toContain('frightened');

    const again = saveAgainst(table.force(GLARE, 'second', 'second-glare'), GLARE);
    expect(again?.modes).toContain('advantage');
    expect(again?.sources).toContain(PROTECTION);
  });

  it('is rolled plainly by a warded cleric the Mummy has not frightened', () => {
    const table = aRoom('mummy').ward();
    const first = saveAgainst(table.force(GLARE, 'first'), GLARE);
    expect(first).not.toBeNull();
    expect(first?.modes).not.toContain('advantage');
  });
});

// — what the first save is about ————————————————————————————————————————————————

describe('the first save a printed line forces is about what its failure imposes', () => {
  const BREN = id('bren');

  const fighter = (speciesId: 'human' | 'dwarf'): CharacterChoices => ({
    name: 'Bren',
    classId: 'fighter',
    level: 1,
    speciesId,
    backgroundId: 'soldier',
    languages: ['Elvish', 'Orc'],
    alignment: 'Neutral',
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
    featureChoices: {
      'fighter:weapon-mastery': [],
      ...(speciesId === 'human' ? { 'human:skillful': ['perception'] } : {}),
    },
    feats: {
      'soldier:savage-attacker': { featId: 'savage-attacker' },
      'fighter:fighting-style': { featId: 'defense' },
      ...(speciesId === 'human' ? { 'human:versatile': { featId: 'alert' } } : {}),
    },
  });

  /** The Ghast's Stench, raised at the start of Bren's turn and rolled. */
  const stench = (speciesId: 'human' | 'dwarf') => {
    const table = new Table();
    table.did('the ghast', (s) => addCreature(s, SRD_CONTENT, MONSTER, 'ghast'));
    table.do('Bren', () => createCharacter(SRD_CONTENT, fighter(speciesId), BREN));
    table.do('the room', (s) => setScene(s, { width: 120, depth: 80, height: 20 }));
    table.do('the brazier', (s) => addSceneLandmark(s, 'the brazier', { x: 40, y: 40, z: 0 }));
    table.do('the ghast placed', (s) =>
      placeCreatureInScene(s, MONSTER, { from: { landmark: 'the brazier' }, feet: 0 }),
    );
    table.do('Bren beside it', (s) =>
      placeCreatureInScene(s, BREN, { from: { creature: MONSTER }, feet: 5, bearing: 90 }),
    );
    table.do("Bren's side", (s) => declareCreatureSide(s, BREN, 'party'));
    table.do("the ghast's side", (s) => declareCreatureSide(s, MONSTER, 'foes'));
    table.do('the order', (s) =>
      beginCombat(s, [
        { id: MONSTER, initiative: 20, speed: 30 },
        { id: BREN, initiative: 10, speed: 30 },
      ]),
    );
    // Advanced without a generator, so the debt is raised and left standing.
    table.did('the ghast finishes', (s) => resolveTurn(s));
    const rolled = unwrap(resolvePendingSaves(table.state, supply(table.state, 's')), 'stench');
    expect(rolled.saves).toHaveLength(1);
    return rolled.saves[0]!.save;
  };

  it('gives a dwarf Advantage against the Ghast’s Stench, which would poison him', () => {
    const save = stench('dwarf');
    expect(save.mode).toBe('advantage');
    expect(save.modeSources.map((one) => one.source).join(' ')).toMatch(/Dwarven Resilience/i);
  });

  it('gives a human nothing against the same Stench', () => {
    expect(stench('human').mode).toBe('normal');
  });
});

// — the inverse of printedLineSource ————————————————————————————————————————————

describe('printedLineHolder reads the creature back out of a printed line’s source', () => {
  const ZOMBIE = id('cast:3:zombie:0');
  const creatures = (...ids: readonly CharacterId[]): GameState =>
    fold(
      'holder',
      ids.map(
        (who): GameEvent => ({
          type: 'creature-added',
          id: who,
          name: who,
          sheet: sheet(),
          maxHp: 10,
          diesAtZero: true,
          creatureType: 'Undead',
          side: 'foes',
        }),
      ),
    );

  it('finds a raised Zombie, whose engine-minted id carries colons of its own', () => {
    // A creature whose id is a prefix of the Zombie's stands beside it, so a
    // reader that took the first match — or split on a colon — names it.
    const state = creatures(id('cast:3'), ZOMBIE);
    expect(printedLineHolder(state, printedLineSource(ZOMBIE, 'Slam'))).toBe(ZOMBIE);
    expect(printedLineHolder(state, printedLineSource(id('cast:3'), 'Slam'))).toBe(id('cast:3'));
  });

  it('reads through a sub-key filed beneath the line', () => {
    const state = creatures(ZOMBIE);
    expect(printedLineHolder(state, `${printedLineSource(ZOMBIE, 'Slam')}:lasting`)).toBe(ZOMBIE);
  });

  it('answers null for a source that is no printed line, or names nobody here', () => {
    const state = creatures(ZOMBIE);
    expect(printedLineHolder(state, 'Fear#cast:3')).toBeNull();
    expect(printedLineHolder(state, `grapple:${ZOMBIE}`)).toBeNull();
    expect(printedLineHolder(state, printedLineSource(id('ghoul'), 'Claws'))).toBeNull();
  });
});
