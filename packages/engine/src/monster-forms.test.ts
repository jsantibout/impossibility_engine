import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
  placeCreatureInScene,
  resolveTurn,
  setScene,
  takePrintedForm,
  takeStatedBonusAction,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { speedInMode } from './character.js';
import { formWornBy, printedFormsOf, wrongFormFor } from './forms.js';
import { adaptMonster, printedAttackOf, statedBonusActionOf } from './monster.js';
import { effectiveSizeOf } from './size.js';
import { sizeOf } from './positioning.js';

/**
 * A form a stat block's own line puts its creature into.
 *
 * SRD Shape-Shift, printed on thirteen blocks: "The werewolf shape-shifts into
 * a Large wolf-humanoid hybrid or a Medium wolf, or it returns to its true
 * humanoid form. Its game statistics, other than its size, are the same in
 * each form. Any equipment it is wearing or carrying isn't transformed."
 *
 * The sentence says exactly what changes, and these tests hold the engine to
 * the *other* half of it as hard as to the first: the size and the Speeds
 * move, the headings gated on a form start and stop working, and nothing else
 * does anything at all.
 */

const id = (s: string) => asCharacterId(s);
const WOLF = id('wolf');
const GANGER = id('ganger');
const IMP = id('imp');
const TIGER = id('tiger');
const PREY = id('prey');

const SEED = 'forms';

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

/** Each block's own heading, read off the block rather than retyped. */
const shiftLineOf = (monsterId: string): string => {
  const block = SRD_CONTENT.monsterById(monsterId)!;
  const line = [...block.actions, ...block.bonusActions].find((one) => one.forms !== undefined);
  if (line === undefined) throw new Error(`${monsterId} prints no line with forms`);
  return line.name;
};

const WEREWOLF_SHIFT = shiftLineOf('werewolf');
const DOPPELGANGER_SHIFT = shiftLineOf('doppelganger');
const IMP_SHIFT = shiftLineOf('imp');
const WERETIGER_SHIFT = shiftLineOf('weretiger');

/** The one Bonus Action in the book gated on a form: SRD Weretiger, Prowl. */
const PROWL = SRD_CONTENT.monsterById('weretiger')!.bonusActions.find((line) =>
  line.name.startsWith('Prowl'),
)!.name;

/** A werewolf's two gated attack headings, read off the block. */
const werewolfLine = (start: string): string =>
  SRD_CONTENT.monsterById('werewolf')!.actions.find((line) => line.name.startsWith(start))!.name;
const BITE = werewolfLine('Bite');
const LONGBOW = werewolfLine('Longbow');

/**
 * A clearing with a werewolf, a doppelganger, an imp, a weretiger and one
 * creature for the tiger to hide from, all on their feet and in an order.
 */
const inTheClearing = (): Table => {
  const table = new Table();
  for (const [who, block] of [
    [WOLF, 'werewolf'],
    [GANGER, 'doppelganger'],
    [IMP, 'imp'],
    [TIGER, 'weretiger'],
    [PREY, 'commoner'],
  ] as const) {
    table.did(`${block} arrives`, (s) => addCreature(s, SRD_CONTENT, who, block));
  }
  table.do('the clearing', (s) => setScene(s, { width: 200, depth: 200, height: 40 }));
  table.do('the stump', (s) => addSceneLandmark(s, 'the stump', { x: 20, y: 20, z: 0 }));
  let feet = 0;
  for (const who of [WOLF, GANGER, IMP, TIGER, PREY]) {
    feet += 10;
    const at = feet;
    table.do(`${who} stands`, (s) =>
      placeCreatureInScene(s, who, { from: { landmark: 'the stump' }, feet: at, bearing: 90 }),
    );
    table.do(`${who}’s side`, (s) => declareCreatureSide(s, who, who === PREY ? 'party' : 'wild'));
  }
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: WOLF, initiative: 20, speed: 40 },
      { id: GANGER, initiative: 19, speed: 30 },
      { id: IMP, initiative: 18, speed: 20 },
      { id: TIGER, initiative: 17, speed: 40 },
      { id: PREY, initiative: 1, speed: 30 },
    ]),
  );
  return table;
};

const supply = () => ({
  issuer: createRollIssuer('r'),
  rng: createRng(SEED) as Rng,
  content: SRD_CONTENT,
});

/** Hand the turn round until it is this creature's. */
const turnOf = (table: Table, who: string): GameState => {
  for (let guard = 0; guard < 12; guard += 1) {
    const state = table.state;
    if (state.combat!.order[state.combat!.turnIndex]!.id === who) return state;
    table.did('end of turn', (s) => resolveTurn(s, supply()));
  }
  throw new Error(`never reached ${who}'s turn`);
};

/** And round again, so the creature comes back to a turn it has not spent. */
const nextTurnOf = (table: Table, who: string): GameState => {
  table.did('end of turn', (s) => resolveTurn(s, supply()));
  return turnOf(table, who);
};

describe('the adapter carries the forms a block prints', () => {
  it('pins the werewolf’s three forms onto its Bonus Action line', () => {
    const wolf = adaptMonster(SRD_CONTENT.monsterById('werewolf')!, WOLF);
    expect(statedBonusActionOf(wolf.sheet, WEREWOLF_SHIFT)?.forms?.forms).toEqual([
      { name: 'hybrid', sizes: ['large'], speed: null },
      { name: 'wolf', sizes: ['medium'], speed: null },
      { name: 'humanoid', sizes: [], speed: null },
    ]);
    expect(printedFormsOf(wolf.sheet)?.forms.map((form) => form.name)).toEqual([
      'hybrid',
      'wolf',
      'humanoid',
    ]);
  });

  it('pins the gate each qualified attack heading prints', () => {
    const wolf = adaptMonster(SRD_CONTENT.monsterById('werewolf')!, WOLF);
    expect(printedAttackOf(wolf.sheet, BITE)?.onlyInForms).toEqual(['wolf', 'hybrid']);
    expect(printedAttackOf(wolf.sheet, LONGBOW)?.onlyInForms).toEqual(['humanoid', 'hybrid']);
    // And the heading that prints no such clause gains nothing.
    expect(printedAttackOf(wolf.sheet, 'Scratch')?.onlyInForms).toBeUndefined();
  });

  /**
   * **A creature that has never shifted is in its true form**, which is the
   * form its line returns to and not an absence. Reading `CreatureState.form`
   * directly would have made a werewolf standing in its own skin able to bite.
   */
  /**
   * **Which commands ask the gate, written down rather than left to be
   * noticed.**
   *
   * `onlyInForms` reaches the sheet from fourteen attack headings and one
   * Bonus Action, and today only the two hand-over doors read it: a werewolf
   * in wolf form can still draw its longbow, because `commands/attacks.ts`
   * belonged to another track the batch this field landed in. That is a debt
   * and this is where it is recorded — a field carried and unread is the
   * failure this repository finds most often, and a note in a docstring is
   * not a thing that fails.
   *
   * The sweep is over the sources rather than over a list of names, in the
   * shape `coverage.test.ts` uses: the day the swing asks, this fails and
   * whoever wired it takes the entry out in the same commit.
   */
  it('names every command that asks the form gate, and the swing is not one', () => {
    const here = fileURLToPath(new URL('.', import.meta.url));
    const asking: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(`${dir}${entry.name}/`);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          if (readFileSync(`${dir}${entry.name}`, 'utf8').includes('wrongFormFor(')) {
            asking.push(entry.name);
          }
        }
      }
    };
    walk(here);
    // `forms.ts` declares it; `commands/actions.ts` is the one caller.
    expect([...asking].sort()).toEqual(['actions.ts', 'forms.ts']);
  });

  it('reads the printed default for a creature that has not shifted', () => {
    const state = inTheClearing().state;
    expect(state.creatures[WOLF]!.form).toBeNull();
    expect(formWornBy(state.creatures[WOLF]!)).toBe('humanoid');
    // And null for a block that prints no forms at all, which is most of them.
    expect(formWornBy(state.creatures[PREY]!)).toBeNull();
  });

  /**
   * **A heading gated on a form its own block never prints is refused**, which
   * is the half of {@link wrongFormFor} that looks like an accident and is
   * not. SRD Vampire carries three "(… Form Only)" headings and its own
   * Shape-Shift is refused whole — the sentence is gated on sunlight and
   * running water, which the engine cannot evaluate — so the vampire can never
   * be in vampire form as far as anything here can tell, and saying so is what
   * keeps the engine from granting a permission because it could not read the
   * condition.
   */
  it('refuses a heading gated on a form its block never prints', () => {
    const vampire = adaptMonster(SRD_CONTENT.monsterById('vampire')!, id('vampire'));
    expect(printedFormsOf(vampire.sheet)).toBeNull();
    const gated = SRD_CONTENT.monsterById('vampire')!.actions.find((line) =>
      line.name.startsWith('Grave Strike'),
    )!.name;
    const line = printedAttackOf(vampire.sheet, gated)!;
    expect(line.onlyInForms).toEqual(['vampire']);
    const creature = { sheet: vampire.sheet, form: null } as Parameters<typeof wrongFormFor>[0];
    expect(wrongFormFor(creature, line)).toContain('no form its block prints');
  });
});

describe('a werewolf shifts', () => {
  it('takes the wolf, is Medium, and spends the Bonus Action', () => {
    const table = inTheClearing();
    turnOf(table, WOLF);

    const shifted = unwrap(
      takePrintedForm(table.state, WOLF, { line: WEREWOLF_SHIFT, form: 'wolf' }),
      'the shift',
    );
    expect(shifted.form).toBe('wolf');
    expect(shifted.size).toBe('medium');
    expect(shifted.unverified).toEqual([]);

    const after = table.do('the shift', () => ({ ok: true, value: shifted.events }));
    expect(after.combat!.budgets[WOLF]!.bonusAction).toBe(false);
    expect(formWornBy(after.creatures[WOLF]!)).toBe('wolf');
  });

  /**
   * SRD Werewolf: "Bite (Wolf or Hybrid Form Only)", "Longbow (Humanoid or
   * Hybrid Form Only)". Two headings on one block that are never both
   * available, which is the whole point of reading the clause.
   */
  it('gates every heading the block prints a form clause on', () => {
    const table = inTheClearing();
    turnOf(table, WOLF);
    const humanoid = table.state.creatures[WOLF]!;

    // In its own skin: the longbow, not the bite.
    expect(wrongFormFor(humanoid, printedAttackOf(humanoid.sheet, LONGBOW)!)).toBeNull();
    expect(wrongFormFor(humanoid, printedAttackOf(humanoid.sheet, BITE)!)).toContain('wolf');

    const after = table.did('the shift', (s) =>
      takePrintedForm(s, WOLF, { line: WEREWOLF_SHIFT, form: 'wolf' }),
    );
    const wolf = after.creatures[WOLF]!;

    // As a wolf: the bite, not the longbow — and the refusal names the form.
    expect(wrongFormFor(wolf, printedAttackOf(wolf.sheet, BITE)!)).toBeNull();
    const refused = wrongFormFor(wolf, printedAttackOf(wolf.sheet, LONGBOW)!);
    expect(refused).toContain('humanoid or hybrid');
    expect(refused).toContain('wolf form');

    // And the hybrid is the one shape both are printed for.
    expect(
      wrongFormFor({ ...wolf, form: { ...wolf.form!, name: 'hybrid' } }, printedAttackOf(wolf.sheet, BITE)!),
    ).toBeNull();
    expect(
      wrongFormFor(
        { ...wolf, form: { ...wolf.form!, name: 'hybrid' } },
        printedAttackOf(wolf.sheet, LONGBOW)!,
      ),
    ).toBeNull();
  });

  /** "Any equipment it is wearing or carrying isn't transformed." */
  it('leaves the longbow in its inventory', () => {
    const table = inTheClearing();
    turnOf(table, WOLF);
    const before = table.state.creatures[WOLF]!.inventory;
    const after = table.did('the shift', (s) =>
      takePrintedForm(s, WOLF, { line: WEREWOLF_SHIFT, form: 'wolf' }),
    );
    expect(after.creatures[WOLF]!.inventory).toEqual(before);
  });

  it('refuses a form the line does not print, and asks when none was named', () => {
    const table = inTheClearing();
    turnOf(table, WOLF);

    const asked = takePrintedForm(table.state, WOLF, { line: WEREWOLF_SHIFT });
    expect(isNeedsContext(asked)).toBe(true);
    expect(isErr(asked) && asked.code).toBe('undeclared_form');
    expect(contextRequestsOf(asked)[0]?.need).toContain('which form');

    const wrong = takePrintedForm(table.state, WOLF, { line: WEREWOLF_SHIFT, form: 'bear' });
    expect(isErr(wrong) && wrong.code).toBe('no_such_form');

    // And a line that offers no form at all is a different refusal.
    const scratch = takePrintedForm(table.state, WOLF, { line: 'Scratch', form: 'wolf' });
    expect(isErr(scratch) && scratch.code).toBe('no_such_line');
  });

  /**
   * The third refusal on this door, and it is the one that keeps it honest: a
   * line the parser read nothing about a form out of is a line this command
   * must not pretend to execute. SRD Werewolf's Multiattack is printed under
   * Actions, says nothing about a form, and comes back with the door that
   * hands the sentence over.
   */
  it('refuses a printed line whose sentence states no form', () => {
    const table = inTheClearing();
    turnOf(table, WOLF);
    const refused = takePrintedForm(table.state, WOLF, { line: 'Multiattack', form: 'wolf' });
    // The Multiattack is *read* as a sequence, so this door does not even find
    // it; the line that reaches the refusal is one the adapter carried whole.
    expect(isErr(refused) && refused.code).toBe('no_such_line');

    const prowl = takePrintedForm(turnOf(inTheClearing(), TIGER), TIGER, {
      line: PROWL,
      form: 'tiger',
    });
    expect(isErr(prowl) && prowl.code).toBe('line_states_no_form');
  });
});

describe('a doppelganger picks a size', () => {
  /**
   * SRD Doppelganger: "a Medium or Small Humanoid" — one form offered at a
   * choice of sizes, which is the table's to make for the reason the form is.
   */
  it('asks which size, then is that size to every rule that reads one', () => {
    const table = inTheClearing();
    turnOf(table, GANGER);

    const asked = takePrintedForm(table.state, GANGER, {
      line: DOPPELGANGER_SHIFT,
      form: 'humanoid',
    });
    expect(isNeedsContext(asked)).toBe(true);
    expect(isErr(asked) && asked.code).toBe('undeclared_form_size');
    expect(contextRequestsOf(asked)[0]?.need).toContain('which size');

    const refused = takePrintedForm(table.state, GANGER, {
      line: DOPPELGANGER_SHIFT,
      form: 'humanoid',
      size: 'huge',
    });
    expect(isErr(refused) && refused.code).toBe('size_not_printed');

    expect(effectiveSizeOf(table.state, GANGER)).toBe('medium');
    const after = table.did('the shift', (s) =>
      takePrintedForm(s, GANGER, { line: DOPPELGANGER_SHIFT, form: 'humanoid', size: 'small' }),
    );
    expect(effectiveSizeOf(after, GANGER)).toBe('small');
    // The scene's copy follows the form, which is the owner's ruling of
    // 2026-09-20 about Wild Shape and this same question.
    expect(sizeOf(after.scene!, GANGER)).toBe('small');
  });

  /** And the line's own true form puts the block's size back. */
  it('returns to its own size when it returns to its own form', () => {
    const table = inTheClearing();
    turnOf(table, GANGER);
    table.did('the shift', (s) =>
      takePrintedForm(s, GANGER, { line: DOPPELGANGER_SHIFT, form: 'humanoid', size: 'small' }),
    );
    const next = nextTurnOf(table, GANGER);
    expect(effectiveSizeOf(next, GANGER)).toBe('small');
    const back = table.did('the return', (s) =>
      takePrintedForm(s, GANGER, { line: DOPPELGANGER_SHIFT, form: 'true' }),
    );
    expect(effectiveSizeOf(back, GANGER)).toBe('medium');
    expect(sizeOf(back.scene!, GANGER)).toBe('medium');
    expect(formWornBy(back.creatures[GANGER]!)).toBe('true');
  });
});

describe('an imp takes a raven’s Speeds', () => {
  /**
   * SRD Imp: "a rat (Speed 20 ft.), a raven (20 ft., Fly 60 ft.), or a spider
   * (20 ft., Climb 20 ft.)" — the one thing that sentence says changes.
   */
  it('replaces the block’s Speeds rather than joining them', () => {
    const table = inTheClearing();
    turnOf(table, IMP);
    const own = table.state.creatures[IMP]!.sheet;
    expect(speedInMode(own, 'walk')).toBe(20);
    expect(speedInMode(own, 'fly')).toBe(40);

    const raven = table.did('the raven', (s) =>
      takePrintedForm(s, IMP, { line: IMP_SHIFT, form: 'raven' }),
    ).creatures[IMP]!.sheet;
    expect(speedInMode(raven, 'walk')).toBe(20);
    expect(speedInMode(raven, 'fly')).toBe(60);

    // The rat prints a walking Speed and nothing else, so the imp's own Fly
    // Speed is gone rather than kept — a join would have left it winged.
    nextTurnOf(table, IMP);
    const rat = table.did('the rat', (s) =>
      takePrintedForm(s, IMP, { line: IMP_SHIFT, form: 'rat' }),
    ).creatures[IMP]!.sheet;
    expect(speedInMode(rat, 'walk')).toBe(20);
    expect(speedInMode(rat, 'fly')).toBe(0);

    // And its own form, measured from the block rather than from the rat.
    nextTurnOf(table, IMP);
    const back = table.did('the imp again', (s) =>
      takePrintedForm(s, IMP, { line: IMP_SHIFT, form: 'true' }),
    ).creatures[IMP]!.sheet;
    expect(speedInMode(back, 'fly')).toBe(40);
  });
});

describe('a weretiger prowls', () => {
  /**
   * SRD Weretiger, "Prowl (Tiger or Hybrid Form Only)" — the one Bonus Action
   * in the book that prints the clause, and so the one gated line a door in
   * `commands/actions.ts` can reach.
   */
  it('is refused in its own skin and taken as a tiger', () => {
    const table = inTheClearing();
    turnOf(table, TIGER);

    const refused = takeStatedBonusAction(table.state, TIGER, { line: PROWL });
    expect(isErr(refused) && refused.code).toBe('wrong_form');

    table.did('the tiger', (s) =>
      takePrintedForm(s, TIGER, { line: WERETIGER_SHIFT, form: 'tiger' }),
    );
    const next = nextTurnOf(table, TIGER);
    expect(unwrap(takeStatedBonusAction(next, TIGER, { line: PROWL }), 'the prowl').events.length)
      .toBeGreaterThan(0);
  });
});
