import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import {
  addCreature,
  advanceTime,
  beginCombat,
  castPrintedLine,
  declareCreatureSide,
  declareSightBetween,
  endCombat,
  placeCreatureInScene,
  setScene,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { adaptMonster } from './monster.js';
import { createRollIssuer } from './rolls.js';

/**
 * **Borrowed spells at the book's own terms** — M-MIND.
 *
 * SRD Succubus, Charm: "The succubus casts Dominate Person **(level 8
 * version)**, requiring no spell components and using Charisma as the
 * spellcasting ability (spell save DC 15)." SRD Sea Hag, Illusory Appearance:
 * "The hag casts _Disguise Self_, using Constitution as the spellcasting
 * ability (spell save DC 13). **The spell's duration is 24 hours.**"
 *
 * Two clauses a cast line prints about this casting rather than about the
 * spell: the level it counts as, which for a caster with slots is the slot's
 * to say, and a span over the spell's own. The route carries both and the
 * casting pipeline reads them where it reads a slot and a band — so the
 * casting is pinned at level 8 with Dominate Person's eight hours, and the
 * disguise holds for a day where a Wizard's lasts an hour.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const CASTER = id('caster');
const VILLAGER = id('villager');

const supply = (seed = 'borrowed') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

class Table {
  private readonly log: GameEvent[] = [];

  get state(): GameState {
    return fold('borrowed-spells', this.log);
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

/** The caster and a villager twenty feet off, in a fight the caster opens. */
const aMeeting = (block: string): Table => {
  const table = new Table();
  table.did('the caster', (s) => addCreature(s, SRD_CONTENT, CASTER, block));
  table.did('the villager', (s) => addCreature(s, SRD_CONTENT, VILLAGER, 'commoner'));
  table.do('the lane', (s) => setScene(s, { width: 200, depth: 200, height: 20 }));
  table.add([{ type: 'landmark-added', name: 'the well', at: { x: 100, y: 100, z: 0 } }]);
  table.do('the caster at the well', (s) =>
    placeCreatureInScene(s, CASTER, { from: { landmark: 'the well' }, feet: 0 }),
  );
  table.do('the villager down the lane', (s) =>
    placeCreatureInScene(s, VILLAGER, { from: { creature: CASTER }, feet: 20, bearing: 0 }),
  );
  table.do('the caster’s side', (s) => declareCreatureSide(s, CASTER, 'fiends'));
  table.do('the villager’s side', (s) => declareCreatureSide(s, VILLAGER, 'village'));
  table.do('the caster sees the villager', (s) => declareSightBetween(s, CASTER, VILLAGER, true));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: CASTER, initiative: 20, speed: 30 },
      { id: VILLAGER, initiative: 1, speed: 30 },
    ]),
  );
  return table;
};

/** The deadline the casting was given, in seconds from the moment it was cast. */
const spanOf = (events: readonly GameEvent[], castingId: string, at: number): number | null => {
  for (const event of events) {
    if (event.type !== 'effect-scheduled') continue;
    if (event.target.kind !== 'casting' || event.target.castingId !== castingId) continue;
    return event.deadline.kind === 'elapsed' ? event.deadline.at - at : null;
  }
  return null;
};

const castOf = (events: readonly GameEvent[]) =>
  events.find((event): event is Extract<GameEvent, { type: 'spell-cast' }> => event.type === 'spell-cast');

describe('the adapter carries the level and the span onto the route', () => {
  it('compiles the Succubus’s level 8 and the Sea Hag’s day onto their grants', () => {
    const succubus = adaptMonster(SRD_CONTENT.monsterById('succubus')!, CASTER);
    expect(succubus.spellcasting!.granted.find((grant) => grant.spellId === 'dominate-person')).toMatchObject({
      throughLine: 'Charm',
      castLevel: 8,
      saveDc: 15,
      ability: 'cha',
    });
    const hag = adaptMonster(SRD_CONTENT.monsterById('sea-hag')!, CASTER);
    expect(hag.spellcasting!.granted.find((grant) => grant.spellId === 'disguise-self')).toMatchObject({
      throughLine: 'Illusory Appearance',
      durationSeconds: 86400,
      saveDc: 13,
      ability: 'con',
    });
  });
});

describe("the Succubus's Charm casts Dominate Person at level 8", () => {
  it('pins the casting at level 8, with the eight hours a level 8 slot buys', () => {
    const table = aMeeting('succubus');
    const cast = unwrap(
      castPrintedLine(
        table.state,
        CASTER,
        { line: 'Charm', spell: 'dominate-person', casting: { targets: [VILLAGER], fought: [] } },
        supply(),
      ),
      'Charm',
    );
    const after = table.add(cast.events);

    const record = castOf(cast.events)!;
    expect(record).toMatchObject({ spell: 'Dominate Person', level: 8, slot: null });
    // "Your Concentration can last longer with a spell slot of level … 8+ (up
    // to 8 hours)" — the band the casting's level falls in, pinned.
    expect(spanOf(cast.events, cast.castingId!, table.state.elapsed)).toBe(28800);
    expect(after.ongoing[cast.castingId!]!.level).toBe(8);
    expect(after.creatures[CASTER]!.concentration).toMatchObject({ spell: 'Dominate Person', level: 8 });
    // The printed DC, as every cast line's.
    expect(after.ongoing[cast.castingId!]!.numbers.saveDc).toBe(15);
  });

  it('runs past the minute a level 5 casting would end at, and ends at eight hours', () => {
    const table = aMeeting('succubus');
    const cast = unwrap(
      castPrintedLine(
        table.state,
        CASTER,
        { line: 'Charm', spell: 'dominate-person', casting: { targets: [VILLAGER], fought: [] } },
        supply(),
      ),
      'Charm',
    );
    table.add(cast.events);
    table.do('the fight ends', (s) => endCombat(s, { kind: 'flight', side: 'village', letThemGo: true }));
    const later = table.do('two hours pass', (s) => advanceTime(s, 7200, 'the night wears on'));
    expect(later.ongoing[cast.castingId!]).toBeDefined();
    const morning = table.do('six more hours pass', (s) => advanceTime(s, 6 * 3600, 'dawn comes'));
    expect(morning.ongoing[cast.castingId!]).toBeUndefined();
  });
});

describe("the Sea Hag's Illusory Appearance holds for a day", () => {
  it('pins a Disguise Self of twenty-four hours, at the spell’s own level', () => {
    const table = aMeeting('sea-hag');
    const cast = unwrap(
      castPrintedLine(table.state, CASTER, { line: 'Illusory Appearance', spell: 'disguise-self' }, supply()),
      'Illusory Appearance',
    );
    const after = table.add(cast.events);
    const record = castOf(cast.events)!;
    expect(record).toMatchObject({ spell: 'Disguise Self', level: 1 });
    expect(spanOf(cast.events, cast.castingId!, table.state.elapsed)).toBe(86400);
    // The printed DC the Investigation check is made against.
    expect(after.ongoing[cast.castingId!]!.numbers.saveDc).toBe(13);

    table.do('the fight ends', (s) => endCombat(s, { kind: 'flight', side: 'village', letThemGo: true }));
    const evening = table.do('two hours pass', (s) => advanceTime(s, 7200, 'the tide turns'));
    expect(evening.ongoing[cast.castingId!]).toBeDefined();
    const nextDay = table.do('a day passes', (s) => advanceTime(s, 22 * 3600, 'the tide turns again'));
    expect(nextDay.ongoing[cast.castingId!]).toBeUndefined();
  });
});
