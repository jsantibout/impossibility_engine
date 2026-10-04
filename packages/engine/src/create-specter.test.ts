import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { CorruptLogError } from './fold/common.js';
import { walkerOf } from './state.js';
import { addCreature, beginCombat, raisePrintedLine } from './commands.js';
import { printedLineSource } from './monster.js';

/**
 * M-RISE: SRD Wraith, Create Specter.
 *
 * > The wraith targets a Humanoid corpse within 10 feet of itself that has been
 * > dead for no longer than 1 minute. The target's spirit rises as a
 * > **Specter** in the space of its corpse or in the nearest unoccupied space.
 * > The specter is under the wraith's control. The wraith can have no more than
 * > seven specters under its control at a time.
 *
 * Every clause is a fact a rule reads: the corpse's type, how long it has been
 * dead (`Vitals.diedAt`), how far it lies, the block that arrives, the bond it
 * arrives under and the count of those the wraith already controls.
 */

const id = (s: string) => asCharacterId(s);
const WRAITH = id('wraith');
const BANDIT = id('bandit');
const WOLF = id('wolf');
const SPECTER = id('specter-1');
const LINE = 'Create Specter';

const supply = (seed = 'wraith') => ({
  issuer: createRollIssuer(`r-${seed}`),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const arrive = (events: GameEvent[], who: CharacterId, block: string): void => {
  events.push(...unwrap(addCreature(fold('seed', events), SRD_CONTENT, who, block), who).events);
};

/** A wraith, a bandit 5 feet away and a wolf 5 feet the other side, the fight begun. */
function room(): GameEvent[] {
  const events: GameEvent[] = [];
  arrive(events, WRAITH, 'wraith');
  arrive(events, BANDIT, 'bandit');
  arrive(events, WOLF, 'wolf');
  events.push(
    { type: 'creature-side-declared', id: WRAITH, side: 'dead' },
    { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
    { type: 'landmark-added', name: 'the crypt', at: { x: 100, y: 100, z: 0 } },
    { type: 'creature-placed', id: WRAITH, placement: { from: { landmark: 'the crypt' }, feet: 0 } },
    { type: 'creature-placed', id: BANDIT, placement: { from: { creature: WRAITH }, feet: 5, bearing: 0 } },
    { type: 'creature-placed', id: WOLF, placement: { from: { creature: WRAITH }, feet: 5, bearing: 180 } },
  );
  events.push(
    ...unwrap(
      beginCombat(fold('seed', events), [
        { id: WRAITH, initiative: 20, speed: 5 },
        { id: BANDIT, initiative: 10, speed: 30 },
        { id: WOLF, initiative: 5, speed: 40 },
      ]),
      'combat',
    ),
  );
  return events;
}

const killed = (events: GameEvent[], who: CharacterId): GameEvent[] => [
  ...events,
  { type: 'damage-taken', id: who, amount: 100 },
];

const state = (events: readonly GameEvent[]): GameState => fold('seed', events);

describe('Create Specter', () => {
  it('raises a Specter from a Humanoid corpse, under the wraith’s control', () => {
    const events = killed(room(), BANDIT);
    const out = unwrap(
      raisePrintedLine(state(events), WRAITH, { line: LINE, corpse: BANDIT, into: SPECTER }, supply()),
      'Create Specter',
    );
    const after = state([...events, ...out.events]);
    const specter = after.creatures[SPECTER]!;
    expect(specter).toBeDefined();
    expect(specter.name).toBe('Specter');
    expect(specter.creatureType).toBe('Undead');
    // "The specter is under the wraith's control" — a control that does not lapse.
    expect(specter.summonedBy).toEqual({
      by: WRAITH,
      castingId: null,
      controlled: { spell: printedLineSource(WRAITH, LINE) },
    });
    // The spirit of the corpse, and not the body walking: the bandit lies there.
    expect(specter.spiritOf).toBe(BANDIT);
    expect(specter.raisedFrom).toBeNull();
    expect(specter.side).toBe('dead');
    // "in the space of its corpse" — a corpse is no bar to it.
    expect(after.scene!.positions[SPECTER]).toEqual(after.scene!.positions[BANDIT]);
    // The corpse stays; it is the spirit that rose.
    expect(after.creatures[BANDIT]!.vitals.dead).toBe(true);
    expect(out.events.some((e) => e.type === 'action-spent' && e.id === WRAITH)).toBe(true);
  });

  it('leaves the body lying: no rite on it is refused as a body walking, and it stays put when the specter falls', () => {
    const events = killed(room(), BANDIT);
    const raised = [
      ...events,
      ...unwrap(
        raisePrintedLine(state(events), WRAITH, { line: LINE, corpse: BANDIT, into: SPECTER }, supply()),
        'Create Specter',
      ).events,
    ];
    expect(walkerOf(state(raised), BANDIT)).toBeNull();
    const lying = state(raised).scene!.positions[BANDIT];
    // The specter is set down in the corpse's space and then moved off; it is
    // destroyed elsewhere, and the body is where it was.
    const moved: GameEvent[] = [
      ...raised,
      { type: 'creature-moved', id: SPECTER, placement: { from: { creature: WRAITH }, feet: 15, bearing: 90 }, forced: true },
    ];
    const destroyed = killed(moved, SPECTER);
    expect(state(destroyed).creatures[SPECTER]!.vitals.dead).toBe(true);
    expect(state(destroyed).scene!.positions[BANDIT]).toEqual(lying);
  });

  it('refuses a spirit of a corpse the game does not hold', () => {
    const events = killed(room(), BANDIT);
    const raised = [
      ...events,
      ...unwrap(
        raisePrintedLine(state(events), WRAITH, { line: LINE, corpse: BANDIT, into: SPECTER }, supply()),
        'Create Specter',
      ).events,
    ];
    const rewritten = raised.map((event) =>
      event.type === 'creature-summoned' && event.id === SPECTER ? { ...event, spiritOf: id('nobody') } : event,
    );
    expect(() => fold('seed', rewritten)).toThrow(CorruptLogError);
  });

  it('refuses a creature that is not dead', () => {
    const refused = raisePrintedLine(state(room()), WRAITH, { line: LINE, corpse: BANDIT, into: SPECTER }, supply());
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('not_a_corpse');
  });

  it('refuses a corpse that is not Humanoid', () => {
    const events = killed(room(), WOLF);
    const refused = raisePrintedLine(state(events), WRAITH, { line: LINE, corpse: WOLF, into: SPECTER }, supply());
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('wrong_creature_type');
  });

  it('refuses a corpse dead for longer than a minute', () => {
    const events: GameEvent[] = [
      ...killed(room(), BANDIT),
      { type: 'time-advanced', seconds: 61, reason: 'a minute passes' },
    ];
    const refused = raisePrintedLine(state(events), WRAITH, { line: LINE, corpse: BANDIT, into: SPECTER }, supply());
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('dead_too_long');
  });

  it('refuses a corpse whose death the log never timed', () => {
    // A death no fold stamps any more; a log written before `diedAt` existed
    // carries one. Whether a minute has passed cannot be told, so it refuses.
    const world = state(killed(room(), BANDIT));
    const untimed: GameState = {
      ...world,
      creatures: {
        ...world.creatures,
        [BANDIT]: { ...world.creatures[BANDIT]!, vitals: { ...world.creatures[BANDIT]!.vitals, diedAt: null } },
      },
    };
    const refused = raisePrintedLine(untimed, WRAITH, { line: LINE, corpse: BANDIT, into: SPECTER }, supply());
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('death_unrecorded');
  });

  it('refuses a corpse further than 10 feet away', () => {
    const events: GameEvent[] = [
      ...killed(room(), BANDIT),
      { type: 'creature-moved', id: BANDIT, placement: { from: { creature: WRAITH }, feet: 15, bearing: 0 }, forced: true },
    ];
    const refused = raisePrintedLine(state(events), WRAITH, { line: LINE, corpse: BANDIT, into: SPECTER }, supply());
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('out_of_range');
  });

  it('asks which corpse and what to call the specter, rather than choosing', () => {
    const events = killed(room(), BANDIT);
    const noCorpse = raisePrintedLine(state(events), WRAITH, { line: LINE, into: SPECTER }, supply());
    expect(noCorpse.ok).toBe(false);
    if (!noCorpse.ok) {
      expect(noCorpse.kind).toBe('needs-context');
      expect(noCorpse.code).toBe('undeclared_corpse');
    }
    const noName = raisePrintedLine(state(events), WRAITH, { line: LINE, corpse: BANDIT }, supply());
    expect(noName.ok).toBe(false);
    if (!noName.ok) {
      expect(noName.kind).toBe('needs-context');
      expect(noName.code).toBe('undeclared_creature');
    }
  });

  it('raises one spirit from one corpse', () => {
    const events = killed(room(), BANDIT);
    const first = unwrap(
      raisePrintedLine(state(events), WRAITH, { line: LINE, corpse: BANDIT, into: SPECTER }, supply()),
      'first',
    );
    const later: GameEvent[] = [...events, ...first.events, { type: 'turn-advanced' }, { type: 'turn-advanced' }, { type: 'turn-advanced' }];
    const again = raisePrintedLine(state(later), WRAITH, { line: LINE, corpse: BANDIT, into: id('specter-2') }, supply());
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('spirit_already_risen');
  });

  it('refuses an eighth specter while seven stand under the wraith’s control', () => {
    const events = killed(room(), BANDIT);
    for (let n = 1; n <= 7; n += 1) {
      const name = id(`old-${n}`);
      arrive(events, name, 'specter');
      events.push({
        type: 'creature-summoned',
        id: name,
        by: WRAITH,
        controlled: { spell: printedLineSource(WRAITH, LINE) },
      });
    }
    const refused = raisePrintedLine(state(events), WRAITH, { line: LINE, corpse: BANDIT, into: SPECTER }, supply());
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('controls_too_many');

    // A destroyed specter is under nobody's control: one fewer, and the eighth rises.
    const thinned = killed(events, id('old-1'));
    const raised = raisePrintedLine(state(thinned), WRAITH, { line: LINE, corpse: BANDIT, into: SPECTER }, supply());
    expect(raised.ok).toBe(true);
  });
});
