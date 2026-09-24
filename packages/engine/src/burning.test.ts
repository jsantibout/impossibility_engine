import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, type CharacterId, expect as unwrap, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  extinguishFire,
  placeCreatureInScene,
  resolveAttack,
  resolveTurn,
  setScene,
} from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { hazardsOn } from './hazards.js';

/**
 * **A creature set alight**, which the glossary keeps apart from the fifteen
 * conditions and which nothing in the engine could hold.
 *
 * SRD *Burning* [Hazard]: "A burning creature or object takes 1d4 Fire damage
 * at the start of each of its turns. As an action, you can extinguish fire on
 * yourself by giving yourself the Prone condition and rolling on the ground.
 * The fire also goes out if it is doused, submerged, or suffocated."
 *
 * Three stat blocks at CR ≤ 5 print it as a rider on a hit and each prints a
 * different reach: SRD Fire Elemental's Burn catches "a creature or a
 * flammable object", SRD Magmin's Touch catches the same "that isn't being
 * worn or carried", and SRD Barbed Devil's Hurl Flame catches **only** a
 * flammable object — so the devil sets nobody alight, which is the book and
 * not an omission.
 */

const id = (s: string) => asCharacterId(s);
const BREN = id('bren');
const BEAST = id('beast');
const SEED = 'kindling';

const supply = (seed = SEED) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** A level 1 Fighter for the fire to land on. */
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

/** A fighter and a thing that burns, within its reach, in an order. */
const field = (block: string, away = 10): Table => {
  const table = new Table();
  table.do('the fighter arrives', () => createCharacter(SRD_CONTENT, walkOn('Bren'), BREN));
  table.did('the beast arrives', (s) => addCreature(s, SRD_CONTENT, BEAST, block));
  table.do('the field', (s) => setScene(s, { width: 400, depth: 400, height: 100 }));
  table.do('the oak', (s) => addSceneLandmark(s, 'the oak', { x: 200, y: 200, z: 0 }));
  table.do('Bren by the oak', (s) =>
    placeCreatureInScene(s, BREN, { from: { landmark: 'the oak' }, feet: 0 }),
  );
  table.do('the beast nearby', (s) =>
    placeCreatureInScene(s, BEAST, { from: { creature: BREN }, feet: away, bearing: 180 }),
  );
  table.do('Bren’s side', (s) => declareCreatureSide(s, BREN, 'party'));
  table.do('the beast’s side', (s) => declareCreatureSide(s, BEAST, 'wild'));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: BEAST, initiative: 20, speed: 30 },
      { id: BREN, initiative: 10, speed: 30 },
    ]),
  );
  return table;
};

/** A swing with the attack roll forced to land. */
const swing = (table: Table, action: string, options: { readonly commandId?: string } = {}) => {
  const out = unwrap(
    resolveAttack(
      table.state,
      BEAST,
      {
        target: BREN,
        weapon: null,
        action,
        attackBonuses: [{ source: 'forced', flat: 40 }],
        ...(options.commandId === undefined ? {} : { commandId: options.commandId }),
      },
      supply(),
    ),
    `the ${action}`,
  );
  table.log.push(...out.events);
  return { ...out, state: table.state };
};

const conditionsOn = (state: GameState, who: CharacterId): readonly string[] =>
  state.creatures[who]?.conditions.conditions ?? [];

/** The damage the log says was dealt to somebody. */
const dealtTo = (events: readonly GameEvent[], who: CharacterId) =>
  events.filter((e) => e.type === 'damage-taken' && e.id === who);

const burning = (state: GameState, who: CharacterId): boolean =>
  hazardsOn(state, who).some((one) => one.hazard === 'burning');

describe('a hit that sets a creature alight', () => {
  it('leaves the fire elemental’s victim burning', () => {
    const table = field('fire-elemental');
    const out = swing(table, 'Burn');

    expect(out.attack?.hit).toBe(true);
    expect(burning(out.state, BREN)).toBe(true);
    // It is a hazard and not a condition: nothing in the fifteen says so.
    expect(conditionsOn(out.state, BREN)).not.toContain('burning');
  });

  it('leaves the magmin’s victim burning too', () => {
    const table = field('magmin', 5);
    const out = swing(table, 'Touch');

    expect(burning(out.state, BREN)).toBe(true);
  });

  /**
   * SRD Barbed Devil's Hurl Flame catches "a flammable object that isn't being
   * worn or carried" and no creature at all. The engine holds no flammable
   * object, so the clause goes to the table whole and nobody is set alight.
   */
  it('sets nobody alight for a line that only names an object', () => {
    const table = field('barbed-devil');
    const out = swing(table, 'Hurl Flame');

    expect(burning(out.state, BREN)).toBe(false);
    expect(out.unverified.join(' ')).toContain('flammable object');
  });

  /** A second hit re-lights the same fire rather than stacking a second one. */
  it('does not stack a second fire on a creature already alight', () => {
    const table = field('fire-elemental');
    swing(table, 'Burn', { commandId: 'one' });
    const again = swing(table, 'Burn', { commandId: 'two' });

    expect(hazardsOn(again.state, BREN)).toHaveLength(1);
  });
});

describe('what burning costs, and how it goes out', () => {
  /** SRD: "takes 1d4 Fire damage at the start of each of its turns". */
  it('takes 1d4 Fire out of the victim at the start of their turn', () => {
    const table = field('fire-elemental');
    swing(table, 'Burn');

    const brens = unwrap(resolveTurn(table.state, supply('t1')), 'the elemental’s turn ends');
    table.log.push(...brens.events);

    const burnt = dealtTo(brens.events, BREN);
    expect(burnt).toHaveLength(1);
    const dice = brens.events.filter(
      (e) => e.type === 'damage-dice-recorded' && e.components.some((c) => c.type === 'fire'),
    );
    expect(dice.length).toBeGreaterThan(0);
  });

  /**
   * SRD: "As an action, you can extinguish fire on yourself by giving yourself
   * the Prone condition and rolling on the ground."
   */
  it('goes out for an action, and leaves the creature Prone', () => {
    // The magmin rather than the elemental: its Touch leaves Bren standing,
    // and a creature on the floor at 0 Hit Points cannot spend an action.
    const table = field('magmin', 5);
    swing(table, 'Touch');
    table.did('the elemental’s turn ends', (s) => resolveTurn(s, supply('t1')));

    const rolled = table.do('Bren rolls on the ground', (s) =>
      extinguishFire(s, BREN, { commandId: 'roll' }),
    );

    expect(burning(rolled, BREN)).toBe(false);
    expect(conditionsOn(rolled, BREN)).toContain('prone');
    // The budget says what is *left*: the Action is gone.
    expect(rolled.combat?.budgets[BREN]?.action).toBe(false);
  });

  it('refuses the action to a creature that is not alight', () => {
    const table = field('magmin', 5);
    const refused = extinguishFire(table.state, BREN, { commandId: 'roll' });

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('not_burning');
  });

  /** And the fire is out, so the next turn costs nothing. */
  it('costs nothing at the next boundary once it is out', () => {
    const table = field('magmin', 5);
    swing(table, 'Touch');
    table.did('the elemental’s turn ends', (s) => resolveTurn(s, supply('t1')));
    table.do('Bren rolls on the ground', (s) => extinguishFire(s, BREN, { commandId: 'roll' }));
    table.did('Bren’s turn ends', (s) => resolveTurn(s, supply('t2')));

    const round = unwrap(resolveTurn(table.state, supply('t3')), 'the elemental’s turn ends again');
    expect(dealtTo(round.events, BREN)).toEqual([]);
  });
});
