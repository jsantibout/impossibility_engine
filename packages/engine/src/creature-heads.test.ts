import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, type CharacterId, isErr, expect as unwrap, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureHeads,
  declareCreatureSide,
  placeCreatureInScene,
  resolveAttack,
  setScene,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * How many heads a creature has, and the Attack action that follows from it.
 *
 * SRD Hydra's Multiattack: "The hydra makes as many Bite attacks as it has
 * heads." The parser leaves that line as prose on purpose — it is a count that
 * reads off a fact nobody has declared, and a number the engine invented would
 * be the engine writing the stat block. So the count is *declared*, like a
 * creature's side and unlike its type: heads die and grow back, so a later
 * declaration replaces the earlier one.
 *
 * The engine still derives the number of swings. It derives it from a declared
 * fact instead of inventing one, which is the whole of the shape: an event, a
 * field on the creature, and an Attack action sized by what the table said.
 */

const id = (s: string) => asCharacterId(s);
const BREN = id('bren');
const HYDRA = id('hydra');
const WOLF = id('wolf');

const supply = (seed = 'heads') => ({
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

/** A log built only out of what the engine produced. */
class Table {
  private readonly log: GameEvent[] = [];

  get state(): GameState {
    return fold('heads', this.log);
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

/** A fighter with a monster five feet away, and the monster going first. */
const inTheSwamp = (monster: string, who: CharacterId): Table => {
  const table = new Table();
  table.do('the fighter arrives', () => createCharacter(SRD_CONTENT, walkOn('Bren'), BREN));
  table.did('the monster arrives', (s) => addCreature(s, SRD_CONTENT, who, monster));
  table.do('the shallows', (s) => setScene(s, { width: 60, depth: 40, height: 20 }));
  table.do('the reeds', (s) => addSceneLandmark(s, 'the reeds', { x: 20, y: 20, z: 0 }));
  table.do('Bren in the reeds', (s) =>
    placeCreatureInScene(s, BREN, { from: { landmark: 'the reeds' }, feet: 0 }),
  );
  table.do('the monster beside him', (s) =>
    placeCreatureInScene(s, who, { from: { creature: BREN }, feet: 5, bearing: 90 }),
  );
  table.do('Bren’s side', (s) => declareCreatureSide(s, BREN, 'party'));
  table.do('the monster’s side', (s) => declareCreatureSide(s, who, 'wild'));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: who, initiative: 20, speed: 40 },
      { id: BREN, initiative: 1, speed: 30 },
    ]),
  );
  return table;
};

/** One Bite at Bren, with the roll forced to land so the count is what is tested. */
const bite = (state: GameState) =>
  resolveAttack(
    state,
    HYDRA,
    {
      target: BREN,
      weapon: null,
      action: 'Bite',
      attackBonuses: [{ source: 'forced', flat: 40 }],
    },
    supply(),
  );

describe('a head count is declared, and the swings follow it', () => {
  /**
   * Today's answer, kept: an Attack action holds one swing unless something
   * says otherwise, and nothing has. What changes is that the engine says so
   * — through `unverified`, which is the channel for a fact it proceeded past
   * conservatively, and never through a `needs-context` that would stop the
   * fight to ask.
   */
  it('bites once while nobody has said how many heads it has, and reports the assumption', () => {
    const table = inTheSwamp('hydra', HYDRA);
    const first = table.did('the first bite', bite);

    expect(first.creatures.hydra!.heads).toBeNull();
    const second = bite(first);
    expect(isErr(second) && second.code).toBe('no_attacks_left');
  });

  it('says out loud that one swing was an assumption, and names the command that settles it', () => {
    const table = inTheSwamp('hydra', HYDRA);
    const swung = unwrap(bite(table.state), 'the bite');

    // The line it could not read, named — the block prints exactly one.
    expect(swung.unverified.some((line) => /Multiattack/.test(line))).toBe(true);
    expect(swung.unverified.some((line) => /declareCreatureHeads/.test(line))).toBe(true);
  });

  /** A refusal would be a fight stopped to ask a question nobody has to answer. */
  it('never turns the missing count into a needs-context', () => {
    const table = inTheSwamp('hydra', HYDRA);
    const swung = bite(table.state);
    expect(isErr(swung)).toBe(false);
  });

  /**
   * SRD Hydra: "The hydra makes as many Bite attacks as it has heads." Five
   * heads, five Bites, and the sixth is a swing the action does not hold.
   */
  it('holds as many bites as the table declared heads', () => {
    const table = inTheSwamp('hydra', HYDRA);
    table.do('five heads', (s) => declareCreatureHeads(s, HYDRA, 5));

    for (const nth of [1, 2, 3, 4, 5]) table.did(`bite ${nth}`, bite);
    const sixth = bite(table.state);

    expect(isErr(sixth) && sixth.code).toBe('no_attacks_left');
  });

  /** And the count is enough: no clause reports an assumption nobody made. */
  it('reports no assumption once the count is declared', () => {
    const table = inTheSwamp('hydra', HYDRA);
    table.do('three heads', (s) => declareCreatureHeads(s, HYDRA, 3));
    const swung = unwrap(bite(table.state), 'the bite');

    expect(swung.unverified.some((line) => /declareCreatureHeads/.test(line))).toBe(false);
  });

  /**
   * SRD Hydra: "Whenever the hydra takes 25 damage or more on a single turn,
   * one of its heads dies… the hydra grows two heads for each of its heads
   * that died." So the fact is written to be changed, exactly as a side is,
   * and a second declaration replaces the first rather than contradicting it.
   */
  it('replaces the count when the table declares it again', () => {
    const table = inTheSwamp('hydra', HYDRA);
    table.do('five heads', (s) => declareCreatureHeads(s, HYDRA, 5));
    expect(table.state.creatures.hydra!.heads).toBe(5);

    table.do('one bitten off', (s) => declareCreatureHeads(s, HYDRA, 4));
    expect(table.state.creatures.hydra!.heads).toBe(4);
  });

  /** A creature with no heads at all is not a creature; it is a typo. */
  it('refuses a count below one as a value rather than an exception', () => {
    const table = inTheSwamp('hydra', HYDRA);
    const none = declareCreatureHeads(table.state, HYDRA, 0);
    expect(isErr(none) && none.code).toBe('impossible_head_count');
    const fewer = declareCreatureHeads(table.state, HYDRA, -2);
    expect(isErr(fewer) && fewer.code).toBe('impossible_head_count');
    const half = declareCreatureHeads(table.state, HYDRA, 2.5);
    expect(isErr(half) && half.code).toBe('impossible_head_count');
  });

  it('refuses a creature the engine has no record of', () => {
    const table = inTheSwamp('hydra', HYDRA);
    const out = declareCreatureHeads(table.state, id('nobody'), 3);
    expect(isErr(out) && out.code).toBe('unknown_creature');
  });

  /** A retry is not a second declaration. */
  it('declares once under a repeated command id', () => {
    const table = inTheSwamp('hydra', HYDRA);
    table.do('five heads', (s) => declareCreatureHeads(s, HYDRA, 5, { commandId: 'the-heads' }));
    const again = unwrap(
      declareCreatureHeads(table.state, HYDRA, 5, { commandId: 'the-heads' }),
      'the retry',
    );

    expect(again).toEqual([]);
    expect(table.state.creatures.hydra!.heads).toBe(5);
  });

  /**
   * The fold opens no catalogue: the count is on the creature because an event
   * put it there, and the Attack action the fold re-sizes reads the same
   * number the command did.
   */
  it('folds back with no content at all', () => {
    const table = inTheSwamp('hydra', HYDRA);
    table.do('five heads', (s) => declareCreatureHeads(s, HYDRA, 5));
    table.did('a bite', bite);

    const replayed = fold('heads', table.events);
    expect(replayed.creatures.hydra!.heads).toBe(5);
    // One of the five spent, four left in the action the fold sized.
    expect(replayed.combat!.budgets.hydra!.attacksRemaining).toBe(4);
  });

  /**
   * And a block with nothing unread is left exactly where it was. The Wolf's
   * Attack action holds one Bite because its block prints no Multiattack at
   * all — nothing about it went unread, so nothing is assumed and nothing is
   * reported. A clause on every stat block without a sequence would be noise
   * about a fact that is not missing.
   */
  it('assumes nothing for a block whose every action line was read', () => {
    const table = inTheSwamp('wolf', WOLF);
    const swung = unwrap(
      resolveAttack(
        table.state,
        WOLF,
        {
          target: BREN,
          weapon: null,
          action: 'Bite',
          attackBonuses: [{ source: 'forced', flat: 40 }],
        },
        supply(),
      ),
      'the bite',
    );

    expect(swung.attack?.hit).toBe(true);
    expect(swung.unverified.some((line) => /declareCreatureHeads/.test(line))).toBe(false);
  });
});
