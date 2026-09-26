/**
 * The holds around a creature, executed — W7-B10.
 *
 * SRD Animated Rug of Smothering, Smother: "The rug can smother only one
 * creature at a time. While grappling the target, the rug can't take this
 * action, the rug halves the damage it takes (round down), and the target takes
 * the same amount of damage." SRD Water Elemental, Whelm: "The elemental can
 * grapple one Large creature or up to two Medium or smaller creatures at a
 * time." SRD Mimic, Pseudopod: "Ability checks made to escape this grapple have
 * Disadvantage." SRD Giant Crocodile, Bite: "While Grappled, the target …
 * can't be targeted by the crocodile's Tail." SRD Allosaurus, Claws: "the
 * target has the Prone condition, and the allosaurus can make one Bite attack
 * against it."
 *
 * Six sentences the hit reader used to hand back, each read now into a field
 * on the hold and executed where the fact is asked: at the swing, at the
 * escape, at the damage, at the door.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, type CharacterId, expect as unwrap, isErr, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  escapeGrapple,
  forcePrintedSave,
  placeCreatureInScene,
  resolveAttack,
  resolveMove,
  resolveTurn,
  setScene,
} from './commands.js';
import { hasCondition } from './conditions.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { grapplesOn } from './commands/unarmed.js';

const id = (s: string) => asCharacterId(s);
const BEAST = id('beast');
const BREN = id('bren');
const SABLE = id('sable');
const THIRD = id('third');
const SEED = 'held';

class Table {
  readonly log: GameEvent[] = [];
  get state(): GameState {
    return fold(SEED, this.log);
  }
  do(step: string, produce: (state: GameState) => Result<readonly GameEvent[]>): GameState {
    this.log.push(...unwrap(produce(this.state), step));
    return this.state;
  }
  did(step: string, produce: (state: GameState) => Result<{ readonly events: readonly GameEvent[] }>): GameState {
    this.log.push(...unwrap(produce(this.state), step).events);
    return this.state;
  }
  private draws = 0;
  supply() {
    this.draws += 1;
    return {
      issuer: createRollIssuer(`r${this.draws}`),
      rng: createRng(`${SEED}:${this.draws}`) as Rng,
      content: SRD_CONTENT,
    };
  }
}

/** The beast by the oak, with two knights beside it and a third further off; the beast's turn first. */
function field(block: string, away = 5): Table {
  const table = new Table();
  table.did('the beast arrives', (s) => addCreature(s, SRD_CONTENT, BEAST, block));
  for (const who of [BREN, SABLE, THIRD]) {
    table.did(`${who} arrives`, (s) => addCreature(s, SRD_CONTENT, who, 'knight'));
  }
  table.do('the field', (s) => setScene(s, { width: 400, depth: 400, height: 100 }));
  table.do('the oak', (s) => addSceneLandmark(s, 'the oak', { x: 200, y: 200, z: 0 }));
  table.do('the beast by the oak', (s) => placeCreatureInScene(s, BEAST, { from: { landmark: 'the oak' }, feet: 0 }));
  // North of the beast's own box, however big the beast is: a placement
  // measured from a creature is measured from its origin cube, and five feet
  // north of a Large beast's origin is inside its own body. So the knights
  // stand `away` feet past the far edge of the footprint the block prints.
  const footprint = { tiny: 5, small: 5, medium: 5, large: 10, huge: 15, gargantuan: 20 }[
    table.state.creatures[BEAST]!.size ?? 'medium'
  ];
  const north = 200 + footprint + away - 5;
  table.do('Bren north', (s) => placeCreatureInScene(s, BREN, { from: { point: { x: 200, y: north, z: 0 } }, feet: 0, bearing: 0 }));
  table.do('Sable beside him', (s) => placeCreatureInScene(s, SABLE, { from: { point: { x: 205, y: north, z: 0 } }, feet: 0, bearing: 0 }));
  table.do('the third far off', (s) => placeCreatureInScene(s, THIRD, { from: { point: { x: 200, y: 300, z: 0 } }, feet: 0, bearing: 0 }));
  table.do("the beast's side", (s) => declareCreatureSide(s, BEAST, 'wild'));
  for (const who of [BREN, SABLE, THIRD]) table.do(`${who}'s side`, (s) => declareCreatureSide(s, who, 'party'));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: BEAST, initiative: 20, speed: 40 },
      { id: BREN, initiative: 10, speed: 30 },
      { id: SABLE, initiative: 8, speed: 30 },
      { id: THIRD, initiative: 6, speed: 30 },
    ]),
  );
  return table;
}

/** A swing with the attack roll forced to land: a miss answers nothing here. */
const swing = (
  table: Table,
  action: string | null,
  options: { readonly who?: CharacterId; readonly target?: CharacterId; readonly hold?: true; readonly commandId?: string } = {},
) =>
  resolveAttack(
    table.state,
    options.who ?? BEAST,
    {
      target: options.target ?? BREN,
      weapon: null,
      ...(action === null ? {} : { action }),
      attackBonuses: [{ source: 'forced', flat: 40 }],
      ...(options.hold === undefined ? {} : { holdInsteadOfDamage: true }),
      ...(options.commandId === undefined ? {} : { commandId: options.commandId }),
    },
    table.supply(),
  );

const endTurn = (table: Table, step: string): void => {
  table.did(step, (s) => resolveTurn(s, table.supply(), { commandId: step }));
};

describe("the Animated Rug of Smothering's hold", () => {
  it('halves the damage the rug takes while it holds, and the held creature takes the same amount', () => {
    const table = field('animated-rug-of-smothering');
    const held = unwrap(swing(table, 'Smother', { hold: true }), 'the smother');
    table.log.push(...held.events);
    expect(grapplesOn(table.state, BREN).map((one) => one.grappler)).toEqual([BEAST]);
    endTurn(table, 'the rug is done');
    // Bren is held and Restrained; Sable, beside the rug, strikes it.
    endTurn(table, 'bren is done');
    const rugHp = table.state.creatures[BEAST]!.vitals.hp;
    const brenHp = table.state.creatures[BREN]!.vitals.hp;
    const struck = unwrap(
      resolveAttack(
        table.state,
        SABLE,
        { target: BEAST, weapon: null, action: 'Greatsword', attackBonuses: [{ source: 'forced', flat: 40 }] },
        table.supply(),
      ),
      'the blow',
    );
    table.log.push(...struck.events);
    const state = table.state;
    const rolled = struck.events.find((e) => e.type === 'damage-dice-recorded');
    expect(rolled).toBeDefined();
    const total = (rolled as { readonly components: readonly { readonly total: number }[] }).components.reduce(
      (sum, one) => sum + one.total,
      0,
    );
    const rugTook = rugHp - state.creatures[BEAST]!.vitals.hp;
    // "halves the damage it takes (round down)"
    expect(rugTook).toBe(Math.floor(total / 2));
    // "and the target takes the same amount of damage"
    expect(brenHp - state.creatures[BREN]!.vitals.hp).toBe(rugTook);
    // Under its own source, so the log says why a knight the sword never
    // touched was hurt: the blow's own name, then whose hold shared it.
    expect(
      struck.events.some(
        (e) => e.type === 'damage-taken' && e.id === BREN && e.source.includes(`${BEAST}'s hold`) && e.source.includes('Greatsword'),
      ),
    ).toBe(true);
  });

  it("refuses the rug its Smother while it is holding somebody, and a second hold past its one", () => {
    const table = field('animated-rug-of-smothering');
    table.log.push(...unwrap(swing(table, 'Smother', { hold: true }), 'the smother').events);
    for (const step of ['rug', 'bren', 'sable', 'third']) endTurn(table, `${step} is done`);
    const again = swing(table, 'Smother', { target: SABLE, hold: true, commandId: 'again' });
    expect(isErr(again) && again.code === 'line_forbidden_while_holding').toBe(true);
    // Nothing was spent for the refusal.
    expect(table.state.combat!.budgets[BEAST]!.action).toBe(true);
  });
});

describe("the Water Elemental's cap on what it holds", () => {
  it('refuses a third creature where two Medium ones are already held', () => {
    const table = field('water-elemental');
    for (const who of [BREN, SABLE]) {
      table.log.push({ type: 'condition-applied', id: who, condition: 'grappled', source: `grapple:${BEAST}` });
    }
    const refused = forcePrintedSave(table.state, BEAST, { line: 'Whelm (Recharge 4–6)', targets: [THIRD] }, table.supply());
    expect(isErr(refused) && refused.code === 'holding_enough').toBe(true);
    expect(table.state.combat!.budgets[BEAST]!.action).toBe(true);
  });
});

describe("the Mimic's harder escape", () => {
  it('rolls the escape at Disadvantage, and the Disadvantage lifts with the hold', () => {
    const table = field('mimic');
    table.log.push(...unwrap(swing(table, 'Pseudopod'), 'the pseudopod').events);
    expect(grapplesOn(table.state, BREN).map((one) => one.grappler)).toEqual([BEAST]);
    endTurn(table, 'the mimic is done');
    const tried = unwrap(escapeGrapple(table.state, BREN, { ability: 'str' }, table.supply()), 'the escape');
    expect(tried.check?.mode).toBe('disadvantage');
    // A forced success ends the hold and the grant under it.
    const freed = unwrap(
      escapeGrapple(table.state, BREN, { ability: 'str', bonuses: [{ source: 'forced', flat: 40 }], commandId: 'free' }, table.supply()),
      'the escape',
    );
    table.log.push(...freed.events);
    expect(freed.success).toBe(true);
    expect(table.state.creatures[BREN]!.rollModifiers).toEqual([]);
  });
});

describe("the Giant Crocodile's Tail against the creature it holds", () => {
  it('refuses the Tail at the held creature and allows it at anybody else, until the hold ends', () => {
    const table = field('giant-crocodile');
    table.log.push(...unwrap(swing(table, 'Bite'), 'the bite').events);
    expect(hasCondition(table.state.creatures[BREN]!.conditions, 'grappled')).toBe(true);
    const tail = swing(table, 'Tail', { commandId: 'tail at bren' });
    expect(isErr(tail) && tail.code === 'immune_to_line').toBe(true);
    // Sable is not held, and the sequence still has a Tail in it.
    const other = swing(table, 'Tail', { target: SABLE, commandId: 'tail at sable' });
    expect(other.ok).toBe(true);
    // Bren tears free; the crocodile's next Tail reaches him.
    endTurn(table, 'the crocodile is done');
    table.log.push(
      ...unwrap(
        escapeGrapple(table.state, BREN, { ability: 'str', bonuses: [{ source: 'forced', flat: 40 }] }, table.supply()),
        'the escape',
      ).events,
    );
    expect(table.state.creatures[BREN]!.lineImmunities).toEqual([]);
    for (const step of ['bren', 'sable', 'third']) endTurn(table, `${step} is done`);
    expect(swing(table, 'Tail', { commandId: 'tail again' }).ok).toBe(true);
  });
});

describe("the Allosaurus's charge", () => {
  it('knocks the target Prone and buys one Bite at it this turn, and nothing else', () => {
    const table = field('allosaurus', 35);
    // Thirty feet straight toward Bren, then the Claws.
    table.did('the charge', (s) =>
      resolveMove(s, BEAST, { placement: { from: { creature: BEAST }, feet: 30, bearing: 0 }, commandId: 'charge' }, table.supply()),
    );
    const clawed = unwrap(swing(table, 'Claws'), 'the claws');
    table.log.push(...clawed.events);
    const state = table.state;
    expect(hasCondition(state.creatures[BREN]!.conditions, 'prone')).toBe(true);
    expect(state.combat!.budgets[BEAST]!.grantedAttacks).toMatchObject({ remaining: 1, line: 'Bite', against: BREN });
    // The Attack action is spent; a Bite at Sable finds no swing to make.
    const elsewhere = swing(table, 'Bite', { target: SABLE, commandId: 'bite sable' });
    expect(elsewhere.ok).toBe(false);
    // The Bite the hit bought, at the creature it bought it against.
    const bite = unwrap(swing(table, 'Bite', { commandId: 'bite bren' }), 'the bite');
    table.log.push(...bite.events);
    expect(table.state.combat!.budgets[BEAST]!.grantedAttacks?.remaining).toBe(0);
    // And no second one.
    expect(swing(table, 'Bite', { commandId: 'bite again' }).ok).toBe(false);
  });

  it('buys nothing where the charge was short', () => {
    const table = field('allosaurus', 15);
    table.did('a short step', (s) =>
      resolveMove(s, BEAST, { placement: { from: { creature: BEAST }, feet: 10, bearing: 0 }, commandId: 'step' }, table.supply()),
    );
    const clawed = unwrap(swing(table, 'Claws'), 'the claws');
    table.log.push(...clawed.events);
    expect(hasCondition(table.state.creatures[BREN]!.conditions, 'prone')).toBe(false);
    expect(table.state.combat!.budgets[BEAST]!.grantedAttacks).toBeNull();
  });
});
