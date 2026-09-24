import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  contextRequestsOf,
  isErr,
  isNeedsContext,
  expect as unwrap,
  type Result,
} from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  declareSightBetween,
  placeCreatureInScene,
  setScene,
  takePrintedTeleport,
  takeStatedBonusAction,
} from './commands.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { adaptMonster, statedBonusActionOf } from './monster.js';
import { distanceBetween } from './positioning.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * A line that teleports, taken at the distance the block prints.
 *
 * SRD Blink Dog, Teleport (Recharge 4–6): "The dog teleports up to 40 feet to
 * an unoccupied space it can see." The sentence is Misty Step's with a
 * different subject, so every refusal here is one `teleportTo` already made
 * for a caster — the distance, the occupied space, the scene's extent and the
 * declared sight — and what the line adds is the price: a Bonus Action and a
 * recharge that has to come back before the dog blinks again.
 */

const id = (s: string) => asCharacterId(s);
const BREN = id('bren');
const DOG = id('dog');
const CAT = id('cat');

const SEED = 'blink';

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
const BLINK = SRD_CONTENT.monsterById('blink-dog')!.bonusActions[0]!.name;

/**
 * Bren by the stump, the dog beside him, and a cat forty feet out.
 *
 * The cat is standing where the dog would land, so an occupied space is a
 * destination somebody could honestly name rather than one invented for a
 * refusal.
 */
const inTheClearing = (): Table => {
  const table = new Table();
  table.do('Bren arrives', () => createCharacter(SRD_CONTENT, walkOn('Bren'), BREN));
  table.did('the dog arrives', (s) => addCreature(s, SRD_CONTENT, DOG, 'blink-dog'));
  table.did('the cat arrives', (s) => addCreature(s, SRD_CONTENT, CAT, 'cat'));
  table.do('the clearing', (s) => setScene(s, { width: 200, depth: 200, height: 40 }));
  table.do('the stump', (s) => addSceneLandmark(s, 'the stump', { x: 20, y: 20, z: 0 }));
  table.do('Bren by the stump', (s) =>
    placeCreatureInScene(s, BREN, { from: { landmark: 'the stump' }, feet: 0 }),
  );
  table.do('the dog beside him', (s) =>
    placeCreatureInScene(s, DOG, { from: { creature: BREN }, feet: 5, bearing: 90 }),
  );
  table.do('the cat forty feet on', (s) =>
    placeCreatureInScene(s, CAT, { from: { creature: DOG }, feet: 40, bearing: 90 }),
  );
  table.do('Bren’s side', (s) => declareCreatureSide(s, BREN, 'party'));
  table.do('the dog’s side', (s) => declareCreatureSide(s, DOG, 'wild'));
  table.do('the cat’s side', (s) => declareCreatureSide(s, CAT, 'wild'));
  table.do('the dog sees the cat', (s) => declareSightBetween(s, DOG, CAT, true));
  table.do('the dog sees Bren', (s) => declareSightBetween(s, DOG, BREN, true));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: DOG, initiative: 20, speed: 40 },
      { id: BREN, initiative: 1, speed: 30 },
    ]),
  );
  return table;
};

describe('the adapter carries the teleport the block prints', () => {
  it('pins the distance and the sight clause onto the Bonus Action line', () => {
    const dog = adaptMonster(SRD_CONTENT.monsterById('blink-dog')!, DOG);
    expect(statedBonusActionOf(dog.sheet, BLINK)).toMatchObject({
      name: BLINK,
      teleports: { feet: 40, mustSee: true },
      recharge: { kind: 'die', low: 4 },
    });
  });
});

describe('the dog blinks', () => {
  it('goes forty feet to a seen empty space, and spends the Bonus Action and the recharge', () => {
    const table = inTheClearing();
    const before = unwrap(distanceBetween(table.state.scene!, DOG, CAT), 'the gap');

    const blinked = unwrap(
      takePrintedTeleport(table.state, DOG, {
        line: BLINK,
        to: { from: { creature: CAT }, feet: 5, bearing: 270 },
      }),
      'the blink',
    );
    expect(blinked.feet).toBe(35);

    const after = table.do('the blink', () => ({ ok: true, value: blinked.events }));
    expect(after.combat!.budgets[DOG]!.bonusAction).toBe(false);
    // SRD *Monsters*: "a monster can use the stat block part once."
    expect(after.creatures[DOG]!.expendedLines).toEqual([BLINK]);
    expect(unwrap(distanceBetween(after.scene!, DOG, CAT), 'the new gap')).toBe(5);
    expect(before).toBe(40);

    // And the same line refuses until the die brings it back.
    const again = takePrintedTeleport(after, DOG, {
      line: BLINK,
      to: { from: { creature: BREN }, feet: 5, bearing: 270 },
      commandId: 'twice',
    });
    expect(isErr(again) && again.code).toBe('line_expended');
  });

  it('refuses a space forty-five feet away', () => {
    const table = inTheClearing();
    const far = takePrintedTeleport(table.state, DOG, {
      line: BLINK,
      to: { from: { creature: CAT }, feet: 5, bearing: 90 },
    });
    expect(isErr(far) && far.code).toBe('teleport_too_far');
    // The refusal left no footprint: the Bonus Action is still there.
    expect(table.state.combat!.budgets[DOG]!.bonusAction).toBe(true);
    expect(table.state.creatures[DOG]!.expendedLines).toEqual([]);
  });

  it('refuses the space the cat is standing in', () => {
    const table = inTheClearing();
    // A named bearing, because a zero-foot placement with none sweeps
    // outwards for the nearest free space rather than refusing.
    const onto = takePrintedTeleport(table.state, DOG, {
      line: BLINK,
      to: { from: { creature: CAT }, feet: 0, bearing: 90 },
    });
    expect(isErr(onto) && onto.code).toBe('occupied');
    expect(table.state.combat!.budgets[DOG]!.bonusAction).toBe(true);
  });

  it('refuses a space measured from a creature it cannot see', () => {
    const table = inTheClearing();
    const blind = table.do('the cat slips out of sight', (s) =>
      declareSightBetween(s, DOG, CAT, false),
    );
    const unseen = takePrintedTeleport(blind, DOG, {
      line: BLINK,
      to: { from: { creature: CAT }, feet: 5, bearing: 270 },
    });
    expect(isErr(unseen) && unseen.code).toBe('cannot_see_destination');
  });

  it('asks where, rather than refusing, when nobody has said', () => {
    const table = inTheClearing();
    const asked = takePrintedTeleport(table.state, DOG, { line: BLINK });
    expect(isNeedsContext(asked)).toBe(true);
    expect(isErr(asked) && asked.code).toBe('undeclared_destination');
    expect(contextRequestsOf(asked)[0]!.kind).toBe('position');
  });

  it('refuses a line that states no teleport', () => {
    const table = inTheClearing();
    // The cat's block prints a Bonus Action the parser read nothing out of.
    const nowhere = takePrintedTeleport(table.state, BREN, {
      line: BLINK,
      to: { from: { creature: CAT }, feet: 5, bearing: 270 },
    });
    expect(isErr(nowhere) && nowhere.code).toBe('no_such_line');
  });

  it('refuses the teleport door for a line whose sentence says something else', () => {
    const table = new Table();
    table.did('a goblin arrives', (s) => addCreature(s, SRD_CONTENT, DOG, 'ghost'));
    table.do('the hall', (s) => setScene(s, { width: 60, depth: 60, height: 20 }));
    table.do('the door', (s) => addSceneLandmark(s, 'the door', { x: 10, y: 10, z: 0 }));
    table.do('the ghost by the door', (s) =>
      placeCreatureInScene(s, DOG, { from: { landmark: 'the door' }, feet: 0 }),
    );
    const state = table.do('the order', (s) =>
      beginCombat(s, [{ id: DOG, initiative: 20, speed: 30 }]),
    );
    // SRD Ghost's Etherealness casts a spell and says a second sentence
    // besides; the parser read nothing out of it and this door says so.
    const refused = takePrintedTeleport(state, DOG, {
      line: 'Etherealness',
      to: { from: { landmark: 'the door' }, feet: 5, bearing: 90 },
    });
    expect(isErr(refused) && refused.code).toBe('line_states_no_teleport');
  });

  it('is the second door on one line: the first still hands the sentence over', () => {
    const table = inTheClearing();
    const handed = unwrap(
      takeStatedBonusAction(table.state, DOG, { line: BLINK }),
      'the hand-over',
    );
    expect(handed.unverified[0]).toContain('the engine does not apply that; a DM does');
  });
});
