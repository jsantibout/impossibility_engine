import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, type CharacterId, expect as unwrap, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  placeCreatureInScene,
  resolveAttack,
  setScene,
} from './commands.js';
import { armorClassOf } from './standing.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';

/**
 * **Armour worn down**, which is a fact about one copy of an item rather than
 * about a kind of item.
 *
 * SRD Black Pudding's Dissolving Pseudopod and SRD Gray Ooze's Pseudopod:
 * "Nonmagical armor worn by the target takes a −1 penalty to the AC it offers.
 * The armor is destroyed if the penalty reduces its AC to 10. The penalty can
 * be removed by casting the _Mending_ spell on the armor."
 *
 * The equipped record is where it lands — it is already pinned and already
 * carries the copy — and `armorClassOf` is the reader that spends it. **The
 * Mending half is the engine's now** (W7-B11): SRD Mending carries a `repairs`
 * effect that clears the recorded penalty, so the sentence is consumed beside
 * the ceiling above it rather than handed over, and `mending.test.ts` drives it.
 */

const id = (s: string) => asCharacterId(s);
const KNIGHT = id('knight');
const OOZE = id('ooze');
const SEED = 'acid';

const supply = (seed = SEED) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** A level 5 Fighter in chain mail, which offers 16 and takes a while to eat. */
const inMail = (name: string, armour: string): CharacterChoices => ({
  name,
  classId: 'fighter',
  level: 5,
  subclassId: 'champion',
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
  equipped: armour === '' ? [] : [armour],
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
    'fighter:ability-score-improvement': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

/** A log built only out of what the engine produced. */
class Table {
  readonly log: GameEvent[] = [];

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

/**
 * A knight and an ooze within its reach, in an order — and, where the test
 * asks for it, some acid already eaten into the mail.
 *
 * The wear is seeded as events rather than as six swings, and that is what the
 * fixture is for: a pudding deals 4d8 + 2 Acid a hit and a level 5 Fighter has
 * forty-four Hit Points, so six real pseudopods would be a test about dying.
 * The one swing each test then takes is the real thing end to end.
 */
const field = (block: string, options: {
  readonly armour?: string;
  readonly reach?: number;
  readonly worn?: number;
} = {}): Table => {
  const armour = options.armour ?? 'chain-mail';
  const table = new Table();
  table.do('the knight arrives', () => createCharacter(SRD_CONTENT, inMail('Knight', armour), KNIGHT));
  table.did('the ooze arrives', (s) => addCreature(s, SRD_CONTENT, OOZE, block));
  table.do('the field', (s) => setScene(s, { width: 400, depth: 400, height: 100 }));
  table.do('the oak', (s) => addSceneLandmark(s, 'the oak', { x: 200, y: 200, z: 0 }));
  table.do('the knight by the oak', (s) =>
    placeCreatureInScene(s, KNIGHT, { from: { landmark: 'the oak' }, feet: 0 }),
  );
  table.do('the ooze nearby', (s) =>
    placeCreatureInScene(s, OOZE, { from: { creature: KNIGHT }, feet: options.reach ?? 10, bearing: 180 }),
  );
  table.do('the knight’s side', (s) => declareCreatureSide(s, KNIGHT, 'party'));
  table.do('the ooze’s side', (s) => declareCreatureSide(s, OOZE, 'wild'));
  for (let n = 0; n < (options.worn ?? 0); n += 1) {
    table.log.push({ type: 'armor-penalised', id: KNIGHT, item: 'chain-mail', points: 1 });
  }
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: OOZE, initiative: 20, speed: 20 },
      { id: KNIGHT, initiative: 10, speed: 30 },
    ]),
  );
  return table;
};

/** A pseudopod with the attack roll forced to land. */
const swing = (table: Table, action: string) => {
  const out = unwrap(
    resolveAttack(
      table.state,
      OOZE,
      {
        target: KNIGHT,
        weapon: null,
        action,
        attackBonuses: [{ source: 'forced', flat: 40 }],
        commandId: 'swing',
      },
      supply(),
    ),
    action,
  );
  table.log.push(...out.events);
  return { ...out, state: table.state };
};

const wornBy = (state: GameState, who: CharacterId, item: string) =>
  state.creatures[who]?.equipped.find((held) => held.id === item);

const carrying = (state: GameState, who: CharacterId, item: string) =>
  state.creatures[who]?.inventory.some((line) => line.id === item) ?? false;

describe('armour a hit wears down', () => {
  it('takes a point off the mail, and off the Armour Class it offers', () => {
    const table = field('black-pudding');
    const before = armorClassOf(table.state, KNIGHT);
    const out = swing(table, 'Dissolving Pseudopod');

    expect(wornBy(out.state, KNIGHT, 'chain-mail')?.penalty).toBe(1);
    expect(armorClassOf(out.state, KNIGHT)).toBe(before - 1);
  });

  it('takes the next point off armour acid has already eaten', () => {
    const table = field('black-pudding', { worn: 1 });
    const before = armorClassOf(table.state, KNIGHT);
    const out = swing(table, 'Dissolving Pseudopod');

    expect(wornBy(out.state, KNIGHT, 'chain-mail')?.penalty).toBe(2);
    expect(armorClassOf(out.state, KNIGHT)).toBe(before - 1);
  });

  /**
   * SRD: "The armor is destroyed if the penalty reduces its AC to 10." Chain
   * mail offers 16, so five points leave it offering 11 and the sixth eats it.
   */
  it('leaves mail worn down to 11 on the knight', () => {
    const table = field('black-pudding', { worn: 5 });

    expect(wornBy(table.state, KNIGHT, 'chain-mail')?.penalty).toBe(5);
    expect(armorClassOf(table.state, KNIGHT)).toBe(11);
  });

  it('destroys the mail with the point that would take it to 10', () => {
    const table = field('black-pudding', { worn: 5 });
    const out = swing(table, 'Dissolving Pseudopod');

    expect(wornBy(out.state, KNIGHT, 'chain-mail')).toBeUndefined();
    expect(carrying(out.state, KNIGHT, 'chain-mail')).toBe(false);
    // And the knight is back to 10 + Dexterity, which is what wearing nothing
    // has always meant.
    expect(armorClassOf(out.state, KNIGHT)).toBe(11);
  });

  /** SRD Gray Ooze prints the same three sentences under a plainer heading. */
  it('is the gray ooze’s sentence too', () => {
    const table = field('gray-ooze', { reach: 5 });
    const out = swing(table, 'Pseudopod');

    expect(wornBy(out.state, KNIGHT, 'chain-mail')?.penalty).toBe(1);
  });

  /** Nothing worn is nothing to corrode, and the swing says so. */
  it('says so when the target is wearing no armour', () => {
    const table = field('black-pudding', { armour: '' });
    const out = swing(table, 'Dissolving Pseudopod');

    expect(out.unverified.join(' ')).toContain('no armour');
  });

  /**
   * "The penalty can be removed by casting the _Mending_ spell on the armor" is
   * a rule about the penalty above it, exactly as the ceiling beside it is — and
   * the engine keeps it now: SRD Mending carries a `repairs` effect that clears
   * the recorded penalty from the copy the caster names. So the sentence is
   * consumed rather than carried, and the hit reports nothing about it.
   * `mending.test.ts` is where the other half is driven. (W7-B11)
   */
  it('keeps the Mending sentence rather than handing it back', () => {
    const table = field('black-pudding');
    const out = swing(table, 'Dissolving Pseudopod');

    expect(out.unverified.join(' ')).not.toContain('Mending');
  });
});
