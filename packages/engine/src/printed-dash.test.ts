import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, isErr, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  declareSightBetween,
  placeCreatureInScene,
  resolveMove,
  resolveTurn,
  setScene,
  takeHide,
  takePrintedForm,
  takeStatedAction,
  takeStatedBonusAction,
} from './commands.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { printedLineSource } from './monster.js';
import { createRollIssuer } from './rolls.js';

/**
 * SRD Giant Seahorse, Bubble Dash: "While underwater, the seahorse moves up
 * to half its Swim Speed without provoking Opportunity Attacks." SRD
 * Weretiger, Prowl: "The weretiger moves up to its Speed without provoking
 * Opportunity Attacks. At the end of this movement, the weretiger can take
 * the Hide action." SRD Troll, Charge: "The troll moves up to half its Speed
 * straight toward an enemy it can see."
 *
 * A move a line grants, declared on the move — W7-B9. The spender hands the
 * turn the printed fraction of the printed Speed; the move names the line
 * (`usingLine`), is measured with a Speed the line names, and provokes nothing
 * where the line says so — and provokes exactly as walking does where it does
 * not, which is the whole difference between a dash and a charge.
 */

const id = (s: string) => asCharacterId(s);
const SEAHORSE = id('seahorse');
const WERETIGER = id('weretiger');
const TROLL = id('troll');
const WATCH = id('watch');
const BUBBLE_DASH = 'Bubble Dash';
const PROWL = 'Prowl (Tiger or Hybrid Form Only)';
const CHARGE = 'Charge';

const supply = (state: GameState, seed = 'reef') => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng(seed) : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

class Table {
  readonly log: GameEvent[] = [];
  get state(): GameState {
    return fold('reef', this.log);
  }
  do(step: string, produce: (state: GameState) => Result<readonly GameEvent[]>): GameState {
    this.log.push(...unwrap(produce(this.state), step));
    return this.state;
  }
  did(step: string, produce: (state: GameState) => Result<{ readonly events: readonly GameEvent[] }>): GameState {
    this.log.push(...unwrap(produce(this.state), step).events);
    return this.state;
  }
}

/**
 * One mover at the reef and a hostile watchman (Medium, reach 5, able to see)
 * five feet south of the mover's anchor, whom any move north would ordinarily
 * offer an Opportunity Attack. South rather than east, because a Large mover's
 * box runs east from its anchor and an Opportunity Attack is measured from
 * the reactor to the mover's point.
 */
const atTheReef = (mover: { id: ReturnType<typeof id>; monster: string; speed: number }): Table => {
  const table = new Table();
  table.did('the mover arrives', (s) => addCreature(s, SRD_CONTENT, mover.id, mover.monster));
  table.did('the watch arrives', (s) => addCreature(s, SRD_CONTENT, WATCH, 'guard'));
  table.do('the reef', (s) => setScene(s, { width: 200, depth: 200, height: 30 }));
  table.do('the rock', (s) => addSceneLandmark(s, 'the rock', { x: 50, y: 50, z: 0 }));
  table.do('the mover', (s) => placeCreatureInScene(s, mover.id, { from: { landmark: 'the rock' }, feet: 0 }));
  table.do('the watch', (s) => placeCreatureInScene(s, WATCH, { from: { landmark: 'the rock' }, feet: 5, bearing: 180 }));
  table.do('the watch sees', (s) => declareSightBetween(s, WATCH, mover.id, true));
  table.do('sides', (s) => declareCreatureSide(s, mover.id, 'wild'));
  table.do('sides', (s) => declareCreatureSide(s, WATCH, 'town'));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: mover.id, initiative: 20, speed: mover.speed },
      { id: WATCH, initiative: 10, speed: 30 },
    ]),
  );
  return table;
};

const north = (feet: number) => ({ from: { landmark: 'the rock' }, feet, bearing: 0 });

describe('a Giant Seahorse’s Bubble Dash', () => {
  it('hands the turn half its Swim Speed, and a swim on the line provokes nobody', () => {
    const table = atTheReef({ id: SEAHORSE, monster: 'giant-seahorse', speed: 5 });
    const dashed = unwrap(takeStatedBonusAction(table.state, SEAHORSE, { line: BUBBLE_DASH }), 'the dash');
    table.log.push(...dashed.events);
    // Half of a Swim Speed of 40, pinned onto the grant.
    expect(dashed.events.find((e) => e.type === 'movement-granted')).toMatchObject({
      type: 'movement-granted',
      id: SEAHORSE,
      source: printedLineSource(SEAHORSE, BUBBLE_DASH),
      feet: 20,
    });
    // "While underwater" is the table's, and is handed over; the rest is applied.
    expect(dashed.unverified.join(' ')).toContain('While underwater');
    expect(dashed.unverified.join(' ')).not.toContain('does not apply');

    const swam = unwrap(
      resolveMove(table.state, SEAHORSE, { placement: north(20), mode: 'swim', usingLine: BUBBLE_DASH }, supply(table.state)),
      'the swim',
    );
    table.log.push(...swam.events);
    expect(swam.feet).toBe(20);
    expect(swam.events.some((e) => e.type === 'movement-declared')).toBe(false);
    expect(swam.events.some((e) => e.type === 'creature-moved')).toBe(true);
    expect(swam.events.find((e) => e.type === 'movement-spent')).toMatchObject({
      grant: printedLineSource(SEAHORSE, BUBBLE_DASH),
      feet: 20,
    });
    // The turn's own five feet are untouched.
    expect(table.state.combat!.budgets[SEAHORSE]!.movementSpent).toBe(0);
  });

  it('caps the swim at the printed fraction, insists on the printed Speed, and needs the line taken', () => {
    const table = atTheReef({ id: SEAHORSE, monster: 'giant-seahorse', speed: 5 });
    const untaken = resolveMove(table.state, SEAHORSE, { placement: north(10), mode: 'swim', usingLine: BUBBLE_DASH }, supply(table.state));
    expect(isErr(untaken) && untaken.code === 'no_such_grant').toBe(true);

    table.did('the dash', (s) => takeStatedBonusAction(s, SEAHORSE, { line: BUBBLE_DASH }));
    const far = resolveMove(table.state, SEAHORSE, { placement: north(25), mode: 'swim', usingLine: BUBBLE_DASH }, supply(table.state));
    expect(isErr(far) && far.code === 'not_enough_movement').toBe(true);

    const walked = resolveMove(table.state, SEAHORSE, { placement: north(5), usingLine: BUBBLE_DASH }, supply(table.state));
    expect(isErr(walked) && walked.code === 'wrong_speed_for_line').toBe(true);

    const noSuchLine = resolveMove(table.state, SEAHORSE, { placement: north(5), mode: 'swim', usingLine: 'Ram' }, supply(table.state));
    expect(isErr(noSuchLine) && noSuchLine.code === 'line_grants_no_move').toBe(true);
  });

  it('is the line’s exemption and not the swim’s: the same swim without the line provokes', () => {
    const table = atTheReef({ id: SEAHORSE, monster: 'giant-seahorse', speed: 40 });
    const swam = unwrap(resolveMove(table.state, SEAHORSE, { placement: north(20), mode: 'swim' }, supply(table.state)), 'the swim');
    expect(swam.events.some((e) => e.type === 'movement-declared')).toBe(true);
  });
});

describe('a Seahorse’s Bubble Dash, printed as an Action', () => {
  it('hands the turn its whole Swim Speed from the Action', () => {
    const table = atTheReef({ id: SEAHORSE, monster: 'seahorse', speed: 5 });
    const dashed = unwrap(takeStatedAction(table.state, SEAHORSE, { line: BUBBLE_DASH }), 'the dash');
    expect(dashed.events.find((e) => e.type === 'movement-granted')).toMatchObject({ feet: 20 });
    expect(dashed.events.some((e) => e.type === 'action-spent')).toBe(true);
  });
});

describe('a Weretiger’s Prowl', () => {
  it('moves without provoking and hides from the same Bonus Action', () => {
    const table = atTheReef({ id: WERETIGER, monster: 'weretiger', speed: 40 });
    // Prowl is "(Tiger or Hybrid Form Only)": take the tiger's shape this turn,
    // and Prowl the next.
    table.did('the shape', (s) => takePrintedForm(s, WERETIGER, { line: 'Shape-Shift', form: 'tiger' }));
    for (const step of ['weretiger', 'watch']) {
      table.did(`${step}’s turn ends`, (s) => resolveTurn(s, supply(s), { commandId: `end ${step}` }));
    }
    const prowled = unwrap(takeStatedBonusAction(table.state, WERETIGER, { line: PROWL }), 'the prowl');
    table.log.push(...prowled.events);
    expect(prowled.events.find((e) => e.type === 'movement-granted')).toMatchObject({ feet: 40 });
    // "can take the Hide action": an extra action narrowed to the Hide, priced
    // from the Bonus Action already spent.
    expect(prowled.events.find((e) => e.type === 'turn-budget-granted')).toMatchObject({
      source: printedLineSource(WERETIGER, PROWL),
      action: { only: ['hide'] },
    });

    const moved = unwrap(resolveMove(table.state, WERETIGER, { placement: north(30), usingLine: PROWL }, supply(table.state)), 'the prowl');
    table.log.push(...moved.events);
    expect(moved.events.some((e) => e.type === 'movement-declared')).toBe(false);

    // Out of the watch's sight and in the reeds: the Hide, off the grant, with
    // the turn's own Action still there afterwards.
    table.do('unseen', (s) => declareSightBetween(s, WATCH, WERETIGER, false));
    const hid = unwrap(
      takeHide(table.state, WERETIGER, { usingFeature: printedLineSource(WERETIGER, PROWL), obscured: true }, supply(table.state)),
      'the hide',
    );
    table.log.push(...hid.events);
    expect(hid.check).not.toBeNull();
    expect(table.state.combat!.budgets[WERETIGER]!.action).toBe(true);
    expect(table.state.combat!.budgets[WERETIGER]!.extraActions).toEqual([]);
  });
});

describe('a line that names two Speeds', () => {
  const OTTER = id('otter');
  const SURGE = 'Surge';

  /**
   * A homebrew otter: Speed 20, Swim 40, and a Bonus Action that prints the
   * Xorn's sentence over two Speeds that differ — "moves up to its Speed or
   * Swim Speed without provoking Opportunity Attacks." SRD's only such line
   * prints two equal Speeds, so the bound is proved on an invented one.
   */
  const inTheRiver = (): Table => {
    const table = new Table();
    table.log.push({
      type: 'creature-added',
      id: OTTER,
      name: 'otter',
      sheet: {
        level: 1,
        abilities: { str: 10, dex: 14, con: 10, int: 4, wis: 12, cha: 6 },
        skills: {},
        saveProficiencies: [],
        armor: null,
        shield: null,
        armorTraining: { light: false, medium: false, heavy: false, shields: false },
        baseSpeed: 20,
        speeds: { swim: 40 },
        spellcastingAbility: null,
        weaponProficiencies: [],
        stated: {
          bonusActions: [
            {
              name: SURGE,
              text: 'The otter moves up to its Speed or Swim Speed without provoking Opportunity Attacks.',
              dashes: { fraction: 'whole', modes: ['walk', 'swim'], noOpportunityAttacks: true, handedOver: [] },
            },
          ],
        },
      },
      maxHp: 5,
      diesAtZero: true,
      creatureType: 'Beast',
    });
    table.do('the river', (s) => setScene(s, { width: 200, depth: 200, height: 30 }));
    table.do('the rock', (s) => addSceneLandmark(s, 'the rock', { x: 50, y: 50, z: 0 }));
    table.do('the otter', (s) => placeCreatureInScene(s, OTTER, { from: { landmark: 'the rock' }, feet: 0 }));
    table.do('the order', (s) => beginCombat(s, [{ id: OTTER, initiative: 10, speed: 20 }]));
    table.did('the surge', (s) => takeStatedBonusAction(s, OTTER, { line: SURGE }));
    return table;
  };

  const onward = (feet: number) => ({ from: { creature: OTTER }, feet, bearing: 0 });

  it('pins the larger Speed on the grant and lets the whole of it be swum', () => {
    const table = inTheRiver();
    expect(table.state.combat!.budgets[OTTER]!.grantedMoves).toEqual([{ source: printedLineSource(OTTER, SURGE), feet: 40 }]);
    table.did('twenty feet of swimming', (s) => resolveMove(s, OTTER, { placement: onward(20), mode: 'swim', usingLine: SURGE }, supply(s)));
    table.did('twenty more', (s) => resolveMove(s, OTTER, { placement: onward(20), mode: 'swim', usingLine: SURGE }, supply(s)));
    expect(table.state.combat!.budgets[OTTER]!.grantedMoves).toEqual([{ source: printedLineSource(OTTER, SURGE), feet: 0 }]);
  });

  it('deducts the distance already moved from the slower Speed, as the glossary says', () => {
    // SRD: "you can switch between them during your move, deducting the
    // distance already moved from the new speed." Two walks of twenty would
    // otherwise add up to the swim's forty.
    const table = inTheRiver();
    table.did('twenty feet on foot', (s) => resolveMove(s, OTTER, { placement: onward(20), usingLine: SURGE }, supply(s)));
    const again = resolveMove(table.state, OTTER, { placement: onward(5), usingLine: SURGE }, supply(table.state));
    expect(isErr(again) && again.code === 'not_enough_movement').toBe(true);
    expect(isErr(again) && again.reason).toContain('20 of them already moved');
    // But the swim's twenty are still there, because forty is the swim's.
    const swim = resolveMove(table.state, OTTER, { placement: onward(20), mode: 'swim', usingLine: SURGE }, supply(table.state));
    expect(swim.ok).toBe(true);
  });
});

describe('a Troll’s Charge', () => {
  it('moves half its Speed on the line, provokes exactly as walking does, and hands the direction over', () => {
    const table = atTheReef({ id: TROLL, monster: 'troll', speed: 30 });
    const charged = unwrap(takeStatedBonusAction(table.state, TROLL, { line: CHARGE }), 'the charge');
    table.log.push(...charged.events);
    expect(charged.events.find((e) => e.type === 'movement-granted')).toMatchObject({ feet: 15 });
    expect(charged.unverified.join(' ')).toContain('straight toward an enemy it can see');

    const ran = unwrap(resolveMove(table.state, TROLL, { placement: north(15), usingLine: CHARGE }, supply(table.state)), 'the run');
    // The line prints no exemption, so the watch is offered its swing.
    expect(ran.events.some((e) => e.type === 'movement-declared')).toBe(true);
    expect(ran.unverified.join(' ')).toContain('straight toward an enemy it can see');
  });
});
