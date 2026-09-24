import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  contextRequestsOf,
  isErr,
  isNeedsContext,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import {
  activateSpell,
  addCreature,
  beginCombat,
  castPrintedLine,
  declareCreatureSide,
  declareSightBetween,
  resolveTurn,
  placeCreatureInScene,
  resolveSpell,
  setScene,
  takeStatedBonusAction,
} from './commands.js';
import { extendContent } from './content.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { adaptMonster, perDayTallyKey, statedActionOf, statedBonusActionOf } from './monster.js';
import { createRollIssuer } from './rolls.js';
import { tallied } from './resources.js';
import type { Monster } from '@ie/srd';

/**
 * A line that casts, spent.
 *
 * SRD Priest, Divine Aid (3/Day), under **Bonus Actions**: "The priest casts
 * _Bless, Dispel Magic, Healing Word,_ or _Lesser Restoration,_ using the same
 * spellcasting ability as Spellcasting." The parser has read that sentence for
 * a batch and nothing spent it, because the one thing the casting pipeline
 * could not be told was which slot the *heading* prices the use at — Divine
 * Aid is a Bonus Action offering *Bless*, whose own casting time is an Action.
 *
 * `GrantedSpell.castingTime` is that fact, read in `castingOf` and nowhere
 * else, so a line is a **route** rather than a pipeline of its own and the
 * casting does everything it does for a Wizard: the record, the Concentration,
 * the pinned DC, the deadlines.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const PRIEST = id('priest');
const FANATIC = id('fanatic');
const MEPHIT = id('mephit');
const IMP = id('imp');
const ALLY = id('ally');
const OTHER = id('other');
const FOE = id('foe');

const supply = () => ({
  issuer: createRollIssuer('r'),
  rng: createRng('divine-aid') as Rng,
  content: SRD_CONTENT,
});

class Table {
  private readonly log: GameEvent[] = [];

  get state(): GameState {
    return fold('divine-aid', this.log);
  }

  add(events: readonly GameEvent[]): GameState {
    this.log.push(...events);
    return this.state;
  }

  do(step: string, produce: (state: GameState) => Result<readonly GameEvent[]>): GameState {
    return this.add(unwrap(produce(this.state), step));
  }

  did(
    step: string,
    produce: (state: GameState) => Result<{ readonly events: readonly GameEvent[] }>,
  ): GameState {
    return this.add(unwrap(produce(this.state), step).events);
  }
}

/** The block's own headings, read off the catalogue rather than retyped. */
const DIVINE_AID = SRD_CONTENT.monsterById('priest')!.bonusActions[0]!.name;
const SPIRITUAL_WEAPON = SRD_CONTENT.monsterById('cultist-fanatic')!.bonusActions[0]!.name;
const MEPHIT_SLEEP = SRD_CONTENT.monsterById('dust-mephit')!.actions.find(
  (line) => line.casts !== undefined,
)!.name;
const IMP_INVISIBILITY = SRD_CONTENT.monsterById('imp')!.actions.find(
  (line) => line.casts !== undefined,
)!.name;

/**
 * A chapel: the priest, two of the faithful beside them, and something hostile
 * across the room.
 */
const inTheChapel = (who: CharacterId, block: string): Table => {
  const table = new Table();
  table.did('the caster arrives', (s) => addCreature(s, SRD_CONTENT, who, block));
  table.did('an ally arrives', (s) => addCreature(s, SRD_CONTENT, ALLY, 'commoner'));
  table.did('another ally arrives', (s) => addCreature(s, SRD_CONTENT, OTHER, 'commoner'));
  table.did('something hostile arrives', (s) => addCreature(s, SRD_CONTENT, FOE, 'goblin-warrior'));
  table.do('the chapel', (s) => setScene(s, { width: 200, depth: 200, height: 40 }));
  table.do('the altar', () => addLandmark());
  table.do('the caster at the altar', (s) =>
    placeCreatureInScene(s, who, { from: { landmark: 'the altar' }, feet: 0 }),
  );
  table.do('an ally beside them', (s) =>
    placeCreatureInScene(s, ALLY, { from: { creature: who }, feet: 5, bearing: 90 }),
  );
  table.do('the other ally beside them', (s) =>
    placeCreatureInScene(s, OTHER, { from: { creature: who }, feet: 5, bearing: 270 },
    ),
  );
  table.do('the foe across the room', (s) =>
    placeCreatureInScene(s, FOE, { from: { creature: who }, feet: 20, bearing: 0 }),
  );
  table.do('the caster’s side', (s) => declareCreatureSide(s, who, 'party'));
  table.do('the foe’s side', (s) => declareCreatureSide(s, FOE, 'raiders'));
  table.do('the caster sees the foe', (s) => declareSightBetween(s, who, FOE, true));
  table.do('the caster sees an ally', (s) => declareSightBetween(s, who, ALLY, true));
  table.do('the caster sees the other', (s) => declareSightBetween(s, who, OTHER, true));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: who, initiative: 20, speed: 30 },
      { id: FOE, initiative: 1, speed: 30 },
    ]),
  );
  return table;
};

const addLandmark = (): Result<readonly GameEvent[]> => ({
  ok: true,
  value: [{ type: 'landmark-added', name: 'the altar', at: { x: 100, y: 100, z: 0 } }],
});

describe('the adapter compiles a cast line into the route it is', () => {
  it('reads the ability and the printed DC off the Spellcasting line a cast line names', () => {
    const priest = adaptMonster(SRD_CONTENT.monsterById('priest')!, PRIEST);
    const bless = priest.spellcasting!.granted.find((grant) => grant.spellId === 'bless');
    expect(bless).toMatchObject({
      spellId: 'bless',
      // "using the same spellcasting ability as Spellcasting" — a reference,
      // resolved to the line it names, numbers and all.
      ability: 'wis',
      saveDc: 13,
      // The heading's price, which is the whole reason a route carries one.
      castingTime: 'bonus-action',
      // The line's day is the heading's, spent at the door.
      freeCastPool: null,
      slotCasting: false,
      atWill: true,
    });
    // One grant per spell, because the menu is a menu.
    expect(
      priest
        .spellcasting!.granted.filter((grant) => grant.source === 'priest:divine-aid-3-day')
        .map((grant) => grant.spellId)
        .sort(),
    ).toEqual(['bless', 'dispel-magic', 'healing-word', 'lesser-restoration']);
  });

  it('takes the ability and the DC the line states outright, where it states them', () => {
    const mephit = adaptMonster(SRD_CONTENT.monsterById('dust-mephit')!, MEPHIT);
    expect(mephit.spellcasting!.granted).toEqual([
      {
        spellId: 'sleep',
        source: 'dust-mephit:sleep-1-day',
        ability: 'cha',
        // The heading is the only road in: `routesFor` leaves this route out
        // of what a casting finds for itself, because the price is the
        // heading's and a casting that reached it unasked would pay nothing.
        throughLine: MEPHIT_SLEEP,
        saveDc: 10,
        castingTime: 'action',
        freeCastPool: null,
        slotCasting: false,
        atWill: true,
      },
    ]);
    // The block prints no Spellcasting line at all, so the creature's
    // spellcasting is grants and no class — a shape `routesFor` has always read.
    expect(mephit.spellcasting!.classes).toEqual([]);
  });

  it('pins the line onto the sheet, where the door reads it', () => {
    const priest = adaptMonster(SRD_CONTENT.monsterById('priest')!, PRIEST);
    expect(statedBonusActionOf(priest.sheet, DIVINE_AID)).toMatchObject({
      name: DIVINE_AID,
      perDay: 3,
      casts: { spells: ['bless', 'dispel-magic', 'healing-word', 'lesser-restoration'] },
    });
    const imp = adaptMonster(SRD_CONTENT.monsterById('imp')!, IMP);
    expect(statedActionOf(imp.sheet, IMP_INVISIBILITY)).toMatchObject({
      casts: { spells: ['invisibility'], ability: 'cha', selfOnly: true },
    });
  });

  /**
   * "The same spellcasting ability as Spellcasting" names a line, and a block
   * that prints none has not said which ability. Refused whole, with the
   * reason on the sheet's caveats — the engine picking one for it would be the
   * engine inventing a number the book declined to print.
   */
  it('refuses a reference to a Spellcasting line the block does not print', () => {
    const priest = SRD_CONTENT.monsterById('priest')!;
    const orphaned: Monster = {
      ...priest,
      // The Spellcasting line taken out, and the reference left standing.
      actions: priest.actions.filter((line) => line.spellcasting === undefined),
    };
    const adapted = adaptMonster(orphaned, PRIEST);
    expect(adapted.spellcasting).toBeNull();
    expect(adapted.caveats.join(' ')).toContain('no Spellcasting line');
  });
});

describe('a Priest spends Divine Aid', () => {
  it('casts Bless on two allies as a Bonus Action, at the block’s own save DC', () => {
    const table = inTheChapel(PRIEST, 'priest');

    const cast = unwrap(
      castPrintedLine(
        table.state,
        PRIEST,
        { line: DIVINE_AID, spell: 'bless', casting: { targets: [ALLY, OTHER] } },
        supply(),
      ),
      'Divine Aid',
    );
    const after = table.add(cast.events);

    // The pipeline did everything it does for any casting.
    expect(cast.castingId).toBe('cast:1');
    expect(after.ongoing[cast.castingId!]).toBeDefined();
    const record = cast.events.find((event) => event.type === 'spell-cast');
    expect(record).toMatchObject({ spell: 'Bless', castingId: 'cast:1' });
    // The Priest's printed Spellcasting DC, off the line the cast line names.
    expect(after.ongoing[cast.castingId!]!.numbers.saveDc).toBe(13);

    // The heading's slot went and the Action did not — which is the whole of
    // what `GrantedSpell.castingTime` buys: *Bless* prints an Action.
    expect(after.combat!.budgets[PRIEST]!.bonusAction).toBe(false);
    expect(after.combat!.budgets[PRIEST]!.action).toBe(true);
    // And one of the three uses the heading rations, in the ledger the
    // hand-over door reads.
    expect(tallied(after.creatures[PRIEST]!.resources, perDayTallyKey(DIVINE_AID))).toBe(1);
    // No slot: the creature holds none and the line offers none.
    expect(
      cast.events.some((event) => event.type === 'resource-spent' && event.key.startsWith('slot')),
    ).toBe(false);
  });

  it('refuses a spell the line does not offer', () => {
    const table = inTheChapel(PRIEST, 'priest');
    const wrong = castPrintedLine(
      table.state,
      PRIEST,
      { line: DIVINE_AID, spell: 'fireball', casting: { targets: [ALLY] } },
      supply(),
    );
    expect(isErr(wrong) && wrong.code).toBe('spell_not_on_the_line');
    expect(table.state.combat!.budgets[PRIEST]!.bonusAction).toBe(true);
  });

  it('asks which spell rather than choosing one', () => {
    const table = inTheChapel(PRIEST, 'priest');
    const asked = castPrintedLine(table.state, PRIEST, { line: DIVINE_AID }, supply());
    expect(isNeedsContext(asked)).toBe(true);
    expect(isErr(asked) && asked.code).toBe('undeclared_spell');
    expect(contextRequestsOf(asked)[0]!.kind).toBe('route');
  });

  /**
   * **Refused before anything is spent**, which is the discipline every door
   * on a printed line keeps. Who a spell reaches is the *casting's* question
   * and `no_targets` is the pipeline's own answer to it — the point here is
   * that it arrives while refusing is still free: the Bonus Action is still
   * there and the day's count has not moved.
   */
  it('refuses a casting with no target, and spends nothing while it refuses', () => {
    const table = inTheChapel(PRIEST, 'priest');
    const asked = castPrintedLine(
      table.state,
      PRIEST,
      { line: DIVINE_AID, spell: 'bless' },
      supply(),
    );
    expect(isErr(asked) && asked.code).toBe('no_targets');
    expect(table.state.combat!.budgets[PRIEST]!.bonusAction).toBe(true);
    expect(tallied(table.state.creatures[PRIEST]!.resources, perDayTallyKey(DIVINE_AID))).toBe(0);
  });

  /**
   * And the day runs out where the heading says it does — in the very ledger
   * `takeStatedAction` reads, so two doors on one heading cannot disagree
   * about what is left of it.
   */
  it('refuses once the day’s three uses are gone, whichever door spent them', () => {
    const table = inTheChapel(PRIEST, 'priest');
    let state = table.state;
    for (let use = 0; use < 3; use += 1) {
      state = table.add(
        unwrap(
          takeStatedBonusAction(state, PRIEST, {
            line: DIVINE_AID,
            commandId: `hand-over-${use}`,
          }),
          'the hand-over door',
        ).events,
      );
      state = table.did('the priest’s turn ends', (s) =>
        resolveTurn(s, supply(), { commandId: `priest-ends-${use}` }),
      );
      state = table.did('and the foe’s', (s) =>
        resolveTurn(s, supply(), { commandId: `foe-ends-${use}` }),
      );
    }

    const gone = castPrintedLine(
      state,
      PRIEST,
      { line: DIVINE_AID, spell: 'bless', casting: { targets: [ALLY] } },
      supply(),
    );
    expect(isErr(gone) && gone.code).toBe('daily_limit_reached');
  });

  it('refuses the casting door for a line that casts nothing', () => {
    const table = inTheChapel(PRIEST, 'priest');
    const nothing = castPrintedLine(
      table.state,
      PRIEST,
      { line: 'Spellcasting', spell: 'bless', casting: { targets: [ALLY] } },
      supply(),
    );
    // The Spellcasting line *is* on the sheet — the parser read a spell list
    // out of it and no attack — and it casts nothing this door can take: what
    // it declares is the creature's own list, which the pipeline already has.
    expect(isErr(nothing) && nothing.code).toBe('line_casts_nothing');
  });
});

describe('the rest of the book’s cast lines', () => {
  /**
   * SRD Dust Mephit, Sleep (1/Day): "using Charisma as the spellcasting
   * ability (spell save DC 10)". A line that states its own ability and its
   * own number, and a block that prints no Spellcasting line at all.
   */
  it('casts a Dust Mephit’s Sleep with Charisma at the printed DC 10', () => {
    const table = inTheChapel(MEPHIT, 'dust-mephit');
    const cast = unwrap(
      castPrintedLine(
        table.state,
        MEPHIT,
        {
          line: MEPHIT_SLEEP,
          spell: 'sleep',
          casting: { targets: [FOE], at: { x: 100, y: 120, z: 0 } },
        },
        supply(),
      ),
      'the mephit sleeps the goblin',
    );
    const after = table.add(cast.events);
    expect(after.ongoing[cast.castingId!]!.numbers.saveDc).toBe(10);
    // The heading is under Actions, so the Action is what it costs.
    expect(after.combat!.budgets[MEPHIT]!.action).toBe(false);
    expect(after.combat!.budgets[MEPHIT]!.bonusAction).toBe(true);
    expect(tallied(after.creatures[MEPHIT]!.resources, perDayTallyKey(MEPHIT_SLEEP))).toBe(1);
  });

  /**
   * SRD Cultist Fanatic, Spiritual Weapon (2/Day). The force stands where the
   * line put it and swings again on a later turn through the activation the
   * definition prints — which is the whole point of handing a printed line to
   * the pipeline rather than executing it at the door.
   */
  it('stands a Cultist Fanatic’s Spiritual Weapon where the line said', () => {
    const table = inTheChapel(FANATIC, 'cultist-fanatic');
    const cast = unwrap(
      castPrintedLine(
        table.state,
        FANATIC,
        {
          line: SPIRITUAL_WEAPON,
          spell: 'spiritual-weapon',
          casting: { targets: [], at: { x: 100, y: 105, z: 0 } },
        },
        supply(),
      ),
      'the force appears',
    );
    const after = table.add(cast.events);
    const running = after.ongoing[cast.castingId!]!;
    expect(running.spellId).toBe('spiritual-weapon');
    expect(running.origin).toEqual({ x: 100, y: 105, z: 0 });
    // The Cultist Fanatic's Spellcasting line prints DC 12, and the cast line
    // points at it.
    expect(running.numbers.saveDc).toBe(12);
    expect(after.combat!.budgets[FANATIC]!.bonusAction).toBe(false);

    // And it swings again on a later turn, through the activation the
    // *definition* prints — which is the whole point of handing a printed line
    // to the pipeline rather than executing it at the door.
    const later = table.did('a round goes by', (s) =>
      resolveTurn(s, supply(), { commandId: 'fanatic-ends' }),
    );
    const round = table.add(
      unwrap(resolveTurn(later, supply(), { commandId: 'foe-ends' }), 'the foe’s turn').events,
    );
    const swing = unwrap(
      activateSpell(
        round,
        FANATIC,
        { castingId: cast.castingId!, targets: [FOE], to: { x: 100, y: 120, z: 0 } },
        supply(),
      ),
      'the force swings again',
    );
    expect(swing.outcomes.map((one) => one.target)).toEqual([FOE]);
  });

  /**
   * SRD Imp: "The imp casts _Invisibility_ **on itself**, requiring no spell
   * components and using Charisma as the spell-casting ability." At will — the
   * heading rations nothing — and on nobody else.
   */
  it('turns an Imp invisible, at will, and refuses to turn anybody else', () => {
    const table = inTheChapel(IMP, 'imp');
    const cast = unwrap(
      castPrintedLine(
        table.state,
        IMP,
        { line: IMP_INVISIBILITY, spell: 'invisibility', casting: { targets: [IMP] } },
        supply(),
      ),
      'the imp vanishes',
    );
    const after = table.add(cast.events);
    expect(after.ongoing[cast.castingId!]).toBeDefined();
    // Nothing was rationed, so nothing is expended: the heading prints no
    // recharge and no count.
    expect(after.creatures[IMP]!.expendedLines).toEqual([]);
    expect(tallied(after.creatures[IMP]!.resources, perDayTallyKey(IMP_INVISIBILITY))).toBe(0);
    // And the components clause is said out loud rather than enforced.
    expect(cast.unverified.join(' ')).toContain('models no components');

    const somebodyElse = castPrintedLine(
      table.state,
      IMP,
      {
        line: IMP_INVISIBILITY,
        spell: 'invisibility',
        casting: { targets: [ALLY] },
        commandId: 'on-somebody-else',
      },
      supply(),
    );
    expect(isErr(somebodyElse) && somebodyElse.code).toBe('line_casts_on_itself');
  });
});

describe('the line is the only way to the route it opens', () => {
  /**
   * **The price is the heading's, so the route must not be reachable around
   * it.** A Priest whose Bless could be cast straight through `resolveSpell`
   * would cast it all day: no recharge to expend, no count between dawns to
   * run down, nothing but the Bonus Action the route prices it at. So
   * `routesFor` leaves a line-bound grant out of what a casting finds for
   * itself, and the casting is told the creature knows the spell from nothing.
   */
  it('refuses an ordinary casting of a spell only a printed line supplies', () => {
    const table = inTheChapel(PRIEST, 'priest');
    const around = resolveSpell(
      table.state,
      PRIEST,
      { spellId: 'bless', targets: [ALLY, OTHER] },
      supply(),
    );
    expect(isErr(around) && around.code).toBe('spell_not_available');
    expect(tallied(table.state.creatures[PRIEST]!.resources, perDayTallyKey(DIVINE_AID))).toBe(0);
  });

  /**
   * And a block whose reference the adapter refused has no route at all, which
   * this door reports rather than guessing at: the ability the casting needs
   * is a number the book declined to print.
   */
  it('refuses a line whose ability the block never stated', () => {
    const priest = SRD_CONTENT.monsterById('priest')!;
    const orphaned: Monster = {
      ...priest,
      id: 'orphaned-priest',
      actions: priest.actions.filter((line) => line.spellcasting === undefined),
    };
    const content = unwrap(
      extendContent(SRD_CONTENT, { monsters: [orphaned] }),
      'the orphaned block',
    );
    const table = new Table();
    table.did('the priest arrives', (s) => addCreature(s, content, PRIEST, 'orphaned-priest'));
    table.did('an ally arrives', (s) => addCreature(s, content, ALLY, 'commoner'));
    table.do('the chapel', (s) => setScene(s, { width: 200, depth: 200, height: 40 }));
    table.do('the altar', () => addLandmark());
    table.do('the priest at the altar', (s) =>
      placeCreatureInScene(s, PRIEST, { from: { landmark: 'the altar' }, feet: 0 }),
    );
    table.do('an ally beside them', (s) =>
      placeCreatureInScene(s, ALLY, { from: { creature: PRIEST }, feet: 5, bearing: 90 }),
    );
    table.do('the order', (s) =>
      beginCombat(s, [
        { id: PRIEST, initiative: 20, speed: 30 },
        { id: ALLY, initiative: 1, speed: 30 },
      ]),
    );

    const refused = castPrintedLine(
      table.state,
      PRIEST,
      { line: DIVINE_AID, spell: 'bless', casting: { targets: [ALLY] } },
      { issuer: createRollIssuer('r'), rng: createRng('orphan') as Rng, content },
    );
    expect(isErr(refused) && refused.code).toBe('line_has_no_route');
    // Nothing was spent while it refused.
    expect(table.state.combat!.budgets[PRIEST]!.bonusAction).toBe(true);
  });
});
