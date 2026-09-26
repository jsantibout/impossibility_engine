/**
 * A cast line that offers two spells and fixes its target to somebody else.
 *
 * SRD Unicorn, Unicorn's Blessing (3/Day): "The unicorn touches another
 * creature with its horn and casts _Cure Wounds_ or _Lesser Restoration_ on
 * that creature, using the same spellcasting ability as Spellcasting."
 *
 * Every part of that was already a rule the engine holds — a menu of two, an
 * ability read off the block's own Spellcasting line, a count between dawns, and
 * two definitions the engine executes — and the line was prose, because
 * `parseCastLine` had no field for either of the two clauses that are not the
 * menu. **Both are one flag each.**
 *
 * - The **touch** is read and consumed. Cure Wounds and Lesser Restoration both
 *   print a Range of Touch, so the horn states a rule the spell already states,
 *   and a field for it would be a second copy free to disagree.
 * - "on that creature" is `notSelf`, which is `selfOnly`'s mirror: where the
 *   Imp's Invisibility narrows the target to the caster, this takes the caster
 *   out of the list. A referent with no antecedent is refused whole rather than
 *   read as a target rule nobody printed — see `TOUCH_DELIVERED`.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  applyConditionTo,
  beginCombat,
  castPrintedLine,
  damageCreature,
  declareCreatureSide,
  placeCreatureInScene,
  setScene,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { perDayTallyKey } from './monster.js';
import { tallied } from './resources.js';

const id = (s: string) => asCharacterId(s);
const UNICORN = id('unicorn');
const DRUID = id('druid');

/** The block's own heading, read off the block rather than retyped. */
const LINE = SRD_CONTENT.monsterById('unicorn')!.bonusActions[0]!.name;

const supply = (seed = 'horn') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const unwrap = <T>(result: Result<T>, label = 'ok'): T => {
  if (!result.ok) throw new Error(`${label}: ${result.code} — ${result.reason}`);
  return result.value;
};

const after = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce((s, e) => applyEvent(s, e), state);

/** The unicorn and a wounded druid beside it, with the unicorn's turn running. */
function inTheGlade(): GameState {
  let state = fold('glade', []);
  const step = (result: Result<readonly GameEvent[]>, label: string): void => {
    state = after(state, unwrap(result, label));
  };
  for (const [who, block] of [
    [UNICORN, 'unicorn'],
    [DRUID, 'druid'],
  ] as const) {
    state = after(state, unwrap(addCreature(state, SRD_CONTENT, who, block), block).events);
  }
  step(setScene(state, { width: 120, depth: 80, height: 40 }), 'scene');
  step(addSceneLandmark(state, 'the spring', { x: 40, y: 40, z: 0 }), 'landmark');
  step(placeCreatureInScene(state, UNICORN, { from: { landmark: 'the spring' }, feet: 0 }), 'place');
  step(
    placeCreatureInScene(state, DRUID, { from: { creature: UNICORN }, feet: 10, bearing: 90 }),
    'place the druid',
  );
  step(declareCreatureSide(state, UNICORN, 'party'), 'side');
  step(declareCreatureSide(state, DRUID, 'party'), 'side');
  step(
    beginCombat(state, [
      { id: UNICORN, initiative: 20, speed: 50 },
      { id: DRUID, initiative: 1, speed: 30 },
    ]),
    'combat',
  );
  // A wound for the Cure Wounds to close.
  step(damageCreature(state, DRUID, { amount: 8, type: 'slashing', commandId: 'hurt' }), 'the wound');
  return state;
}

const usedToday = (state: GameState): number =>
  tallied(state.creatures[UNICORN]!.resources, perDayTallyKey(LINE));

describe('the line as the parser reads it', () => {
  it('reads the menu of two, the ability it borrows, and the target it fixes', () => {
    const line = SRD_CONTENT.monsterById('unicorn')!.bonusActions.find((l) => l.name === LINE)!;
    expect(line.casts).toEqual({
      spells: ['cure-wounds', 'lesser-restoration'],
      ability: 'spellcasting',
      notSelf: true,
    });
    // Three a day, off the heading, as every printed count is.
    expect(line.perDay).toBe(3);
  });
});

describe('the unicorn touches the druid with its horn', () => {
  it('casts Cure Wounds by it and spends one of the day’s three', () => {
    const glade = inTheGlade();
    const hurt = glade.creatures[DRUID]!.vitals.hp;
    expect(usedToday(glade)).toBe(0);

    const cast = unwrap(
      castPrintedLine(
        glade,
        UNICORN,
        { line: LINE, spell: 'cure-wounds', casting: { targets: [DRUID] }, commandId: 'cure' },
        supply('cure'),
      ),
      'the blessing',
    );
    const done = after(glade, cast.events);
    expect(done.creatures[DRUID]!.vitals.hp).toBeGreaterThan(hurt);
    expect(usedToday(done)).toBe(1);
    // The numbers are the block's: a Bonus Action went, no slot did.
    expect(done.combat!.budgets[UNICORN]!.bonusAction).toBe(false);
    expect(cast.events.some((e) => e.type === 'spell-cast')).toBe(true);
  });

  it('casts Lesser Restoration off the same line on a later turn', () => {
    const glade = inTheGlade();
    // A condition for the restoration to lift, and the turn the line is taken
    // on rolled round to the unicorn again.
    const sickened = after(
      glade,
      unwrap(applyConditionTo(glade, DRUID, 'poisoned', 'the swamp'), 'the poison'),
    );
    const poisoned = after(sickened, [{ type: 'turn-advanced' }, { type: 'turn-advanced' }]);

    const cast = unwrap(
      castPrintedLine(
        poisoned,
        UNICORN,
        {
          line: LINE,
          spell: 'lesser-restoration',
          casting: { targets: [DRUID], choice: 'poisoned' },
          commandId: 'restore',
        },
        supply('restore'),
      ),
      'the blessing',
    );
    const done = after(poisoned, cast.events);
    expect(done.creatures[DRUID]!.conditions.conditions).toEqual([]);
    expect(usedToday(done)).toBe(1);
  });

  it('refuses the unicorn as its own target, and a spell the line does not offer', () => {
    const glade = inTheGlade();
    const itself = castPrintedLine(
      glade,
      UNICORN,
      { line: LINE, spell: 'cure-wounds', casting: { targets: [UNICORN] }, commandId: 'self' },
      supply('self'),
    );
    expect(isErr(itself) && itself.code).toBe('line_casts_on_another');

    const elsewhere = castPrintedLine(
      glade,
      UNICORN,
      { line: LINE, spell: 'calm-emotions', casting: { targets: [DRUID] }, commandId: 'no' },
      supply('no'),
    );
    expect(isErr(elsewhere) && elsewhere.code).toBe('spell_not_on_the_line');

    // Nothing was spent asking.
    expect(glade.combat!.budgets[UNICORN]!.bonusAction).toBe(true);
    expect(usedToday(glade)).toBe(0);
  });

  it('asks which of the two rather than choosing', () => {
    const unnamed = castPrintedLine(
      inTheGlade(),
      UNICORN,
      { line: LINE, casting: { targets: [DRUID] }, commandId: 'which' },
      supply('which'),
    );
    expect(unnamed.ok).toBe(false);
    if (unnamed.ok) return;
    expect(unnamed.kind).toBe('needs-context');
    expect(unnamed.code).toBe('undeclared_spell');
  });

  it('is refused a fourth time in one day', () => {
    let state = inTheGlade();
    for (const turn of [0, 1, 2]) {
      const cast = unwrap(
        castPrintedLine(
          state,
          UNICORN,
          {
            line: LINE,
            spell: 'cure-wounds',
            casting: { targets: [DRUID] },
            commandId: `cure-${turn}`,
          },
          supply(`cure-${turn}`),
        ),
        `the ${turn} blessing`,
      );
      state = after(state, cast.events);
      // Round the order back to the unicorn for the next one.
      state = after(state, [{ type: 'turn-advanced' }, { type: 'turn-advanced' }]);
    }
    expect(usedToday(state)).toBe(3);

    const fourth = castPrintedLine(
      state,
      UNICORN,
      { line: LINE, spell: 'cure-wounds', casting: { targets: [DRUID] }, commandId: 'fourth' },
      supply('fourth'),
    );
    expect(isErr(fourth) && fourth.code).toBe('daily_limit_reached');
  });
});
