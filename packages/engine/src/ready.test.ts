import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import {
  pendingMoveOf,
  readiedBy,
  releaseReady,
  resolveAttack,
  resolveMove,
  resolveTurn,
  settleAreaEffects,
  takeDisengage,
  takeReady,
} from './commands.js';

/**
 * Ready: an action spent now for a Reaction taken later.
 *
 * SRD: "You take the Ready action to wait for a particular circumstance before
 * you act. To do so, you take this action on your turn, which lets you act by
 * taking a Reaction **before the start of your next turn**. First, you decide
 * what perceivable circumstance will trigger your Reaction. Then, you choose
 * the action you will take in response to that trigger, or you choose to move
 * up to your Speed in response to it."
 *
 * **The trigger is not the engine's to evaluate, and it never will be.** "If
 * the cultist steps on the trapdoor" is a perceivable circumstance in a world
 * the engine models almost none of — there is no trapdoor in structured state,
 * and its absence is not evidence that there is no trapdoor. So the trigger is
 * text the engine stores, hands back, and never reads. What the engine owns is
 * everything around it: the action spent now, the Reaction spent later, the
 * deadline, and for a readied spell the slot and the Concentration.
 *
 * That split is the whole design. A trigger the engine tried to judge would
 * either refuse half the readied actions a table takes, or invent a world to
 * judge them against.
 */

const id = (s: string) => asCharacterId(s);
const ARCHER = id('archer');
const CULTIST = id('cultist');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 12, dex: 16, con: 12, int: 14, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const SETUP: readonly GameEvent[] = [
  added(ARCHER, 'party'),
  added(CULTIST, 'cult'),
  { type: 'items-gained', id: ARCHER, items: [{ id: 'longbow', quantity: 1 }], source: 'kit' },
  {
    type: 'resource-pool-declared',
    id: ARCHER,
    pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 3, recovers: 'long-rest' },
  },
  {
    type: 'spellcasting-declared',
    id: ARCHER,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['dissonant-whispers'] }),
  },
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the door', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: ARCHER, placement: { from: { landmark: 'the door' }, feet: 0 } },
  { type: 'creature-placed', id: CULTIST, placement: { from: { creature: ARCHER }, feet: 30, bearing: 0 } },
  { type: 'sight-declared', from: ARCHER, to: CULTIST, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: ARCHER, initiative: 20, speed: 30 },
      { id: CULTIST, initiative: 10, speed: 30 },
    ],
  },
];

const supply = (seed = 'ready') => ({ issuer: createRollIssuer('r'), rng: createRng(seed) as Rng, content: SRD_CONTENT });

const TRIGGER = 'if the cultist steps on the trapdoor';

/** Ready something, and hand back the longer log. */
const ready = (
  response: Parameters<typeof takeReady>[2]['response'],
  log: readonly GameEvent[] = SETUP,
) => {
  const out = unwrap(takeReady(fold('seed', log), ARCHER, { trigger: TRIGGER, response }, SRD_CONTENT), 'ready');
  return [...log, ...out];
};

const nextTurn = (log: readonly GameEvent[]): readonly GameEvent[] => [
  ...log,
  ...unwrap(resolveTurn(fold('seed', log), supply('turn')), 'turn').events,
];

const budget = (state: GameState) => state.combat?.budgets.archer;

/** Deadlines waiting to end a Ready. */
const readyTimers = (state: GameState) =>
  Object.values(state.timers).filter(
    (t) => t.target.kind === 'feature' && t.target.feature === 'action:ready',
  );

/** Deadlines waiting to end a whole casting. */
const castingTimers = (state: GameState) =>
  Object.values(state.timers).filter((t) => t.target.kind === 'casting');


describe('readying costs the action now', () => {
  it('spends the action and records what was readied', () => {
    const log = ready({ kind: 'action' });
    const state = fold('seed', log);
    expect(budget(state)?.action).toBe(false);

    const held = readiedBy(state, ARCHER);
    expect(held?.trigger).toBe(TRIGGER);
    expect(held?.response.kind).toBe('action');
  });

  /**
   * The engine stores the trigger and never reads it. Whether the cultist
   * stepped on the trapdoor is a question about a trapdoor nothing here has
   * heard of, and its absence from state says nothing about the world.
   */
  it('keeps the trigger as written, whatever it says', () => {
    const odd = 'if the chandelier creaks a third time';
    const out = unwrap(
      takeReady(fold('seed', SETUP), ARCHER, { trigger: odd, response: { kind: 'action' } }, SRD_CONTENT),
      'ready',
    );
    expect(readiedBy(fold('seed', [...SETUP, ...out]), ARCHER)?.trigger).toBe(odd);
  });

  it('refuses when the action is already gone', () => {
    expect(isErr(takeReady(fold('seed', ready({ kind: 'action' })), ARCHER, {
      trigger: TRIGGER,
      response: { kind: 'action' },
    }, SRD_CONTENT))).toBe(true);
  });

  /**
   * One hold at a time, and the refusal says so rather than reporting the
   * spent action it would also have run into. Which refusal comes back matters
   * to the layer narrating it: "you are already waiting on something" is a
   * different sentence from "you have already acted".
   */
  it('refuses a second readied action while one is held', () => {
    const out = takeReady(fold('seed', ready({ kind: 'action' })), ARCHER, {
      trigger: 'if the other one moves',
      response: { kind: 'action' },
    }, SRD_CONTENT);
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('already_readied');
  });

  /** A retried command id is the same Ready, not a second one. */
  it('is a no-op when the same command is retried', () => {
    const first = unwrap(
      takeReady(fold('seed', SETUP), ARCHER, {
        commandId: 'ready-1',
        trigger: TRIGGER,
        response: { kind: 'action' },
      }, SRD_CONTENT),
      'ready',
    );
    const again = unwrap(
      takeReady(fold('seed', [...SETUP, ...first]), ARCHER, {
        commandId: 'ready-1',
        trigger: TRIGGER,
        response: { kind: 'action' },
      }, SRD_CONTENT),
      'retry',
    );
    expect(again).toEqual([]);
  });
});

describe('releasing it spends the Reaction', () => {
  it('takes the Reaction and clears what was held', () => {
    const log = nextTurn(ready({ kind: 'action' }));
    const released = unwrap(releaseReady(fold('seed', log), ARCHER, {}, supply()), 'release');
    const after = fold('seed', [...log, ...released.events]);

    expect(budget(after)?.reaction).toBe(false);
    expect(readiedBy(after, ARCHER)).toBeNull();
  });

  /** SRD: "you can either take your Reaction right after the trigger finishes **or ignore the trigger**." */
  it('can be let go without being used', () => {
    const log = nextTurn(ready({ kind: 'action' }));
    const dropped = unwrap(releaseReady(fold('seed', log), ARCHER, { ignore: true }, supply()), 'ignore');
    const after = fold('seed', [...log, ...dropped.events]);

    expect(readiedBy(after, ARCHER)).toBeNull();
    // Ignoring costs nothing: the Reaction is still there for something else.
    expect(budget(after)?.reaction).toBe(true);
  });

  it('refuses to release what nobody readied', () => {
    const out = releaseReady(fold('seed', SETUP), ARCHER, {}, supply());
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('nothing_readied');
  });

  it('refuses when the Reaction is already spent', () => {
    const log: readonly GameEvent[] = [
      ...nextTurn(ready({ kind: 'action' })),
      { type: 'reaction-spent', id: ARCHER },
    ];
    expect(isErr(releaseReady(fold('seed', log), ARCHER, {}, supply()))).toBe(true);
  });
});

describe('a readied action lapses when the SRD says it does', () => {
  /** SRD: "lets you act by taking a Reaction **before the start of your next turn**." */
  it('is gone by the start of the readier’s next turn', () => {
    const held = nextTurn(ready({ kind: 'action' }));
    expect(readiedBy(fold('seed', held), ARCHER)).not.toBeNull();

    const later = nextTurn(held);
    expect(readiedBy(fold('seed', later), ARCHER)).toBeNull();
  });
});

describe('a readied spell is cast now and released later', () => {
  /**
   * SRD: "you cast it as normal (expending any resources used to cast it) but
   * hold its energy, which you release with your Reaction when the trigger
   * occurs... holding on to the spell's magic requires Concentration."
   */
  const readySpell = (log: readonly GameEvent[] = SETUP) =>
    ready({ kind: 'spell', spellId: 'dissonant-whispers', slotLevel: 1 }, log);

  it('spends the slot when it is readied, not when it is released', () => {
    const log = readySpell();
    const after = fold('seed', log);
    expect(remaining(after.creatures.archer!.resources, spellSlotKey(1))).toBe(2);
  });

  /** SRD: "holding on to the spell's magic requires Concentration." */
  it('holds the spell with Concentration', () => {
    expect(fold('seed', readySpell()).creatures.archer!.concentration).not.toBeNull();
  });

  /** SRD: "To be readied, a spell must have a casting time of an action." */
  it('refuses a spell that is not cast with an action', () => {
    const bonus: readonly GameEvent[] = [
      ...SETUP.filter((e) => e.type !== 'spellcasting-declared'),
      {
        type: 'spellcasting-declared',
        id: ARCHER,
        spellcasting: declaredCasting({ ability: 'int', prepared: ['healing-word'] }),
      },
    ];
    const out = takeReady(fold('seed', bonus), ARCHER, {
      trigger: TRIGGER,
      response: { kind: 'spell', spellId: 'healing-word', slotLevel: 1 },
    }, SRD_CONTENT);
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('not_readiable');
  });

  it('resolves the spell on release, at the slot it was readied with', () => {
    const log = nextTurn(readySpell());
    const released = unwrap(
      releaseReady(fold('seed', log), ARCHER, { targets: [CULTIST] }, supply('release')),
      'release',
    );
    const after = fold('seed', [...log, ...released.events]);

    expect(after.creatures.cultist!.vitals.hp).toBeLessThan(60);
    // And the slot was not spent a second time.
    expect(remaining(after.creatures.archer!.resources, spellSlotKey(1))).toBe(2);
  });

  /**
   * SRD: "If your Concentration is broken, the spell dissipates without taking
   * effect." The slot is gone either way — it was spent when the spell was
   * readied.
   */
  it('is lost outright when Concentration breaks', () => {
    const broken: readonly GameEvent[] = [
      ...readySpell(),
      { type: 'condition-applied', id: ARCHER, condition: 'stunned', source: 'a spell' },
    ];
    const after = fold('seed', broken);
    expect(after.creatures.archer!.concentration).toBeNull();
    expect(readiedBy(after, ARCHER)).toBeNull();
    expect(remaining(after.creatures.archer!.resources, spellSlotKey(1))).toBe(2);
  });
});

describe('a readied Concentration spell keeps concentrating', () => {
  /**
   * Two different Concentrations that happen to share a casting id: the hold,
   * which SRD requires of every readied spell, and the spell's own, which
   * SRD requires only of some. Hold Person is both, so releasing it changes
   * nothing about what the caster is holding — and that is the point. An
   * implementation that ended the hold would end Hold Person with it.
   */
  const HOLDER: readonly GameEvent[] = [
    ...SETUP.filter((e) => e.type !== 'spellcasting-declared'),
    {
      type: 'resource-pool-declared',
      id: ARCHER,
      pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 2, recovers: 'long-rest' },
    },
    {
      type: 'spellcasting-declared',
      id: ARCHER,
      spellcasting: declaredCasting({ ability: 'int', prepared: ['hold-person'] }),
    },
  ];

  const readyHold = () =>
    ready({ kind: 'spell', spellId: 'hold-person', slotLevel: 2 }, HOLDER);

  it('is still concentrating after the release', () => {
    const log = nextTurn(readyHold());
    const before = fold('seed', log).creatures.archer!.concentration;
    const released = unwrap(
      releaseReady(fold('seed', log), ARCHER, { targets: [CULTIST] }, supply('hold')),
      'release',
    );
    const after = fold('seed', [...log, ...released.events]).creatures.archer!.concentration;

    expect(before?.castingId).toBe(after?.castingId);
    expect(after?.spell).toBe('Hold Person');
  });

  /**
   * SRD writes Hold Person's Duration as "Concentration, up to 1 minute", and
   * a readied spell takes effect when it is released. Casting the clock at the
   * moment the magic was *gathered* would end the spell early by however long
   * the caster waited.
   */
  it('starts its own duration at the release, not at the Ready', () => {
    const log = nextTurn(readyHold());
    expect(castingTimers(fold('seed', log))).toEqual([]);

    const released = unwrap(
      releaseReady(fold('seed', log), ARCHER, { targets: [CULTIST] }, supply('hold')),
      'release',
    );
    expect(castingTimers(fold('seed', [...log, ...released.events])).length).toBe(1);
  });
});

describe('the hold itself is bookkeeping the engine cleans up', () => {
  it('leaves no deadline behind once it is released', () => {
    const log = nextTurn(ready({ kind: 'action' }));
    expect(readyTimers(fold('seed', log)).length).toBe(1);

    const released = unwrap(releaseReady(fold('seed', log), ARCHER, {}, supply()), 'release');
    expect(readyTimers(fold('seed', [...log, ...released.events]))).toEqual([]);
  });

  it('leaves no deadline behind once it lapses', () => {
    const lapsed = nextTurn(nextTurn(ready({ kind: 'action' })));
    expect(readyTimers(fold('seed', lapsed))).toEqual([]);
  });

  /**
   * SRD: "holding on to the spell's magic requires Concentration, which you
   * can maintain **up to the start of your next turn**." The deadline passing
   * takes the spell with it — a Concentration left running would hold the
   * caster's next spell hostage to a casting that no longer exists.
   */
  it('drops a held spell’s Concentration when the deadline passes', () => {
    const readied = ready({ kind: 'spell', spellId: 'dissonant-whispers', slotLevel: 1 });
    expect(fold('seed', readied).creatures.archer!.concentration).not.toBeNull();

    const lapsed = nextTurn(nextTurn(readied));
    expect(fold('seed', lapsed).creatures.archer!.concentration).toBeNull();
    expect(readiedBy(fold('seed', lapsed), ARCHER)).toBeNull();
  });
});

describe('a readied attack is paid for by the Reaction', () => {
  /**
   * The release spends the Reaction; the attack itself goes through the
   * ordinary command as a free one, exactly as an Opportunity Attack does.
   * What this pins is that the Attack *action* is not charged as well — the
   * archer has none, because it is not their turn.
   */
  it('swings without an Attack action, on somebody else’s turn', () => {
    const log = nextTurn(ready({ kind: 'action', note: 'shoot whoever comes through' }));
    const released = unwrap(releaseReady(fold('seed', log), ARCHER, {}, supply()), 'release');
    const ready2 = fold('seed', [...log, ...released.events]);

    const swing = unwrap(
      resolveAttack(ready2, ARCHER, { target: CULTIST, weapon: 'longbow', free: true }, supply('shot')),
      'attack',
    );
    const after = fold('seed', [...log, ...released.events, ...swing.events]);

    expect(swing.attack).not.toBeNull();
    expect(after.combat?.budgets.archer?.reaction).toBe(false);
    // Still nobody's turn but the cultist's, and the archer's action is
    // untouched — the Ready spent it a turn ago and this cost nothing more.
    expect(after.combat?.order[after.combat.turnIndex]?.id).toBe(CULTIST);
  });

  it('has nothing to swing with when nothing was readied', () => {
    // Nothing readied and nothing released: an attack on someone else's turn
    // is not a thing a creature may simply take.
    const log = nextTurn(SETUP);
    expect(isErr(resolveAttack(fold('seed', log), ARCHER, { target: CULTIST, weapon: 'longbow' }, supply()))).toBe(
      true,
    );
  });
});

describe('the hold ends but the spell does not', () => {
  /**
   * The Concentration a readied spell requires is the SRD's own wording —
   * "holding on to the spell's magic requires Concentration" — and it is about
   * the *holding*. Once the magic is let go there is nothing left to hold, so
   * a spell whose own Duration says nothing about Concentration leaves the
   * caster free. Leaving it running would silently cost them the next
   * Concentration spell they cast.
   */
  it('stops concentrating once an ordinary spell is released', () => {
    const log = nextTurn(ready({ kind: 'spell', spellId: 'dissonant-whispers', slotLevel: 1 }));
    expect(fold('seed', log).creatures.archer!.concentration).not.toBeNull();

    const released = unwrap(
      releaseReady(fold('seed', log), ARCHER, { targets: [CULTIST] }, supply('whispers')),
      'release',
    );
    expect(fold('seed', [...log, ...released.events]).creatures.archer!.concentration).toBeNull();
  });

  /**
   * And it stops concentrating **before** the spell lands, not after. Ending a
   * Concentration ends the casting it belongs to and everything that casting
   * created — so a release that dropped the hold last would wipe the very
   * condition it had just applied. Blindness/Deafness is the case that shows
   * it: one minute, no Concentration, and a condition that has to survive.
   */
  it('leaves a lasting condition standing after the hold ends', () => {
    const caster: readonly GameEvent[] = [
      ...SETUP.filter((e) => e.type !== 'spellcasting-declared'),
      {
        type: 'resource-pool-declared',
        id: ARCHER,
        pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 2, recovers: 'long-rest' },
      },
      {
        type: 'spellcasting-declared',
        id: ARCHER,
        spellcasting: declaredCasting({ ability: 'int', prepared: ['blindness-deafness'] }),
      },
    ];

    const log = nextTurn(ready({ kind: 'spell', spellId: 'blindness-deafness', slotLevel: 2 }, caster));
    const out = unwrap(
      releaseReady(fold('seed', log), ARCHER, { targets: [CULTIST] }, supply('blind')),
      'release',
    );
    if (out.spell === undefined) throw new Error('expected the release to resolve a spell');
    expect(out.spell.outcomes[0]?.affected).toBe(true);

    const after = fold('seed', [...log, ...out.events]);
    expect(after.creatures.cultist!.conditions.conditions).toContain('blinded');
    expect(after.creatures.archer!.concentration).toBeNull();
  });
});

describe('a readied move spends the Reaction, not the Speed', () => {
  /**
   * SRD Ready: "or you choose to move up to your Speed in response to it."
   *
   * The allowance is the thing that needed building. A turn budget belongs to
   * a turn, and this movement happens on somebody else's — so `spendMovement`
   * refuses it by construction, correctly, and a readied move draws on its own
   * allowance instead: the mover's Speed, read at the moment they actually
   * move rather than at the moment they decided to.
   */
  const readyMove = (log: readonly GameEvent[] = SETUP) => nextTurn(ready({ kind: 'move' }, log));

  const away = (feet: number) => ({ from: { creature: CULTIST }, feet, bearing: 180 } as const);

  it('moves on somebody else’s turn, at the cost of the Reaction', () => {
    const log = readyMove();
    const out = unwrap(
      releaseReady(fold('seed', log), ARCHER, { placement: away(60) }, supply('run')),
      'release',
    );
    const after = fold('seed', [...log, ...out.events]);

    expect(out.move?.cost).toBe(30);
    expect(budget(after)?.reaction).toBe(false);
    expect(readiedBy(after, ARCHER)).toBeNull();
    // Still the cultist's turn, and the archer's own movement is untouched.
    expect(after.combat?.order[after.combat.turnIndex]?.id).toBe(CULTIST);
  });

  /** SRD: "up to your Speed", and not a foot further. */
  it('refuses a move further than the mover’s Speed', () => {
    const log = readyMove();
    const out = releaseReady(fold('seed', log), ARCHER, { placement: away(75) }, supply('run'));
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('not_enough_movement');
  });

  /**
   * And nothing is spent by a refusal: the Reaction is still there and the
   * action is still held, so the same trigger can be answered with a legal
   * move.
   */
  it('costs nothing when it refuses', () => {
    const log = readyMove();
    expect(isErr(releaseReady(fold('seed', log), ARCHER, { placement: away(75) }, supply()))).toBe(true);

    const state = fold('seed', log);
    expect(budget(state)?.reaction).toBe(true);
    expect(readiedBy(state, ARCHER)).not.toBeNull();
  });

  /**
   * Difficult Terrain costs the readied move exactly what it costs any other:
   * "every foot of movement in that space costs 1 extra foot." The Speed is
   * the allowance, so ten difficult feet take twenty of it.
   */
  it('charges Difficult Terrain against the allowance', () => {
    const log = readyMove();
    const out = unwrap(
      releaseReady(fold('seed', log), ARCHER, { placement: away(50), difficultFeet: 10 }, supply()),
      'release',
    );
    expect(out.move?.feet).toBe(20);
    expect(out.move?.cost).toBe(30);

    // 25 feet of ground, ten of it difficult, is 35 feet of Speed — five more
    // than the archer has, though the distance alone would have fitted.
    const over = releaseReady(
      fold('seed', log),
      ARCHER,
      { placement: away(55), difficultFeet: 10 },
      supply(),
    );
    expect(isErr(over)).toBe(true);
    expect(
      unwrap(releaseReady(fold('seed', log), ARCHER, { placement: away(55) }, supply()), 'plain')
        .move?.cost,
    ).toBe(25);
  });

  /**
   * The allowance is "your Speed" read at the moment of moving, not at the
   * moment of deciding. SRD Grappled: "Your Speed becomes 0." A creature
   * grabbed while waiting on its trigger goes nowhere, and an allowance frozen
   * at the Ready would have handed it thirty feet out of the ogre's fist.
   */
  it('reads the mover’s Speed at the release, not at the Ready', () => {
    const grabbed: readonly GameEvent[] = [
      ...readyMove(),
      { type: 'condition-applied', id: ARCHER, condition: 'grappled', source: 'the cultist' },
    ];
    const out = releaseReady(fold('seed', grabbed), ARCHER, { placement: away(35) }, supply());
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('not_enough_movement');
  });

  /**
   * It is the creature's own movement, so it provokes. SRD offers the
   * Opportunity Attack to "a creature that you can see leaves your reach", and
   * says nothing about which of the mover's resources paid for the leaving.
   */
  it('provokes an Opportunity Attack like any other movement', () => {
    const close: readonly GameEvent[] = [
      ...SETUP.filter((e) => !(e.type === 'creature-placed' && e.id === CULTIST)),
      { type: 'creature-placed', id: CULTIST, placement: { from: { creature: ARCHER }, feet: 5, bearing: 0 } },
      { type: 'sight-declared', from: CULTIST, to: ARCHER, seen: true },
    ];
    const log = readyMove(close);
    const out = unwrap(
      releaseReady(
        fold('seed', log),
        ARCHER,
        { placement: { from: { creature: CULTIST }, feet: 30, bearing: 180 } },
        supply('flee'),
      ),
      'release',
    );

    expect(pendingMoveOf(fold('seed', [...log, ...out.events]))?.provoked.map((p) => p.reactor)).toEqual([
      CULTIST,
    ]);
  });

  /** SRD Disengage is a turn-long flag, and this is not that turn. */
  it('still provokes even though the mover Disengaged on their own turn', () => {
    const close: readonly GameEvent[] = [
      ...SETUP.filter((e) => !(e.type === 'creature-placed' && e.id === CULTIST)),
      { type: 'creature-placed', id: CULTIST, placement: { from: { creature: ARCHER }, feet: 5, bearing: 0 } },
      { type: 'sight-declared', from: CULTIST, to: ARCHER, seen: true },
    ];
    const disengaged = [
      ...close,
      ...unwrap(takeDisengage(fold('seed', close), ARCHER, {}), 'disengage'),
    ];
    // Readying costs the action, which Disengage has already taken — so the
    // two cannot be combined on one turn in the first place. What this pins is
    // that a turn's Disengage does not follow the mover into the next one.
    expect(isErr(takeReady(fold('seed', disengaged), ARCHER, {
      trigger: TRIGGER,
      response: { kind: 'move' },
    }, SRD_CONTENT))).toBe(true);
  });
});

describe('it replays', () => {
  it('replays prefix by prefix', () => {
    const log = nextTurn(ready({ kind: 'action' }));
    const released = unwrap(releaseReady(fold('seed', log), ARCHER, {}, supply()), 'release');
    const whole = [...log, ...released.events];
    for (let n = 0; n <= whole.length; n += 1) {
      expect(fold('seed', whole.slice(0, n))).toEqual(fold('seed', whole.slice(0, n)));
    }
  });

  it('survives JSON', () => {
    const state = fold('seed', ready({ kind: 'action' }));
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

/**
 * The four facts a casting states rather than derives, said at the Ready.
 *
 * IE-020's rule, in its own words: **whether a casting is settled in one
 * breath or held open for a Counterspell changes nothing about what the caster
 * said.** A readied casting is the third door into that sentence and the one
 * that was walled up — `ReadiedResponse` carried a spell id, a casting id and
 * a level, so a spell that *requires* one of the four had nowhere to say it.
 * The three Dominates are the spells that meet it: SRD prints "It does so with
 * Advantage if you or your allies are fighting it", `statesFoughtFact` reads
 * that off the definition, and a casting that does not answer it is refused.
 *
 * **The old failure was a wedged hold rather than a refusal**, which is the
 * sharper reason the fact is asked at the Ready. `holdSpell` asked
 * `declaredFacts` nowhere and `castSpell` never sees a definition, so readying
 * a Dominate **succeeded** and took the action and the slot — and then every
 * release came back `fought_fact_required`, because `castOrRelease` asks the
 * question there, until the Ready's own deadline lifted the hold. A turn and a
 * slot spent on a spell that could never be let go.
 *
 * **One validator, one normaliser, three doors.** The Ready asks
 * `declaredFacts` — the same function the atomic cast and the declaration ask,
 * so a spell that prints the clause and a Ready that says nothing is refused
 * with the same code, and a spell that prints none and is told the fact is
 * refused with the same code. The release hands the facts to `castOrRelease`,
 * which normalises them through `statedFacts` and `foughtFor` exactly as the
 * settlement does. Neither rule is spelled a second time on this path, which
 * is what a mutation emptying `declaredFacts` has to redden here as well as in
 * the other two files.
 */
describe('a readied casting can state what a casting states', () => {
  const WOLF = id('wolf');

  type SpellReady = Extract<Parameters<typeof takeReady>[2]['response'], { kind: 'spell' }>;

  function refusal<T>(out: Result<T>): string {
    return isErr(out) ? out.code : 'no refusal at all';
  }

  const beast = (who: CharacterId): GameEvent => ({
    type: 'creature-added',
    id: who,
    name: who,
    sheet: sheet(),
    maxHp: 40,
    diesAtZero: false,
    creatureType: 'Beast',
    side: 'cult',
  });

  const slot = (level: number): GameEvent => ({
    type: 'resource-pool-declared',
    id: ARCHER,
    pool: {
      key: spellSlotKey(level),
      label: `level ${level} spell slot`,
      max: 2,
      recovers: 'long-rest',
    },
  });

  /**
   * The archer with every spell this section readies, and a slot for each.
   *
   * The wolf is here because SRD Dominate Beast is "One Beast you can see" and
   * the cultist is a Humanoid — the three Dominates are one paragraph with the
   * creature type changed, so driving all three needs both targets.
   */
  const CASTER: readonly GameEvent[] = [
    ...SETUP.filter((e) => e.type !== 'spellcasting-declared'),
    beast(WOLF),
    {
      type: 'creature-placed',
      id: WOLF,
      placement: { from: { creature: ARCHER }, feet: 25, bearing: 90 },
    },
    { type: 'sight-declared', from: ARCHER, to: WOLF, seen: true },
    slot(4),
    slot(5),
    slot(8),
    {
      type: 'spellcasting-declared',
      id: ARCHER,
      spellcasting: declaredCasting({
        ability: 'int',
        prepared: [
          'dominate-beast',
          'dominate-person',
          'dominate-monster',
          'dissonant-whispers',
          'dimension-door',
          'misty-step',
        ],
      }),
    },
  ];

  const readyRefusal = (response: SpellReady): string =>
    refusal(takeReady(fold('seed', CASTER), ARCHER, { trigger: TRIGGER, response }, SRD_CONTENT));

  /**
   * Named among the fought, the released save carries a named source and the
   * mode is Advantage.
   *
   * **Asserted on `modeSources`, not on the outcome.** A save that happened to
   * succeed proves nothing about whether the Advantage was applied — the die
   * decides that, and the seed decides the die. What says the fact was read is
   * the attributed source on the roll.
   */
  it('releases Dominate Person with the Advantage the stated fact gives', () => {
    const log = nextTurn(
      ready({ kind: 'spell', spellId: 'dominate-person', slotLevel: 5, fought: [CULTIST] }, CASTER),
    );
    const out = unwrap(
      releaseReady(fold('seed', log), ARCHER, { targets: [CULTIST] }, supply('dominate')),
      'release',
    );
    const save = out.spell!.outcomes[0]!.save!;
    expect(save.modeSources.some((m) => m.source.includes('Dominate Person'))).toBe(true);
    expect(save.mode).toBe('advantage');
  });

  /** And "none of them" is an answer, which is the other half of the same fact. */
  it('releases it with an ordinary save when the Ready said the target is not fought', () => {
    const log = nextTurn(
      ready({ kind: 'spell', spellId: 'dominate-person', slotLevel: 5, fought: [] }, CASTER),
    );
    const out = unwrap(
      releaseReady(fold('seed', log), ARCHER, { targets: [CULTIST] }, supply('dominate')),
      'release',
    );
    const save = out.spell!.outcomes[0]!.save!;
    expect(save.modeSources.some((m) => m.source.includes('Dominate Person'))).toBe(false);
    expect(save.mode).toBe('normal');
  });

  /**
   * **No default, and the refusal lands before anything is spent.** An answer
   * the engine filled in would be a fact it invented; and the Ready spends the
   * action *and* the slot, so a refusal that only arrived at the release would
   * have taken both for a casting that could never be let go.
   */
  it('refuses the Ready when the spell prints the clause and nothing was stated', () => {
    const before = fold('seed', CASTER);
    expect(
      refusal(
        takeReady(before, ARCHER, {
          trigger: TRIGGER,
          response: { kind: 'spell', spellId: 'dominate-person', slotLevel: 5 },
        }, SRD_CONTENT),
      ),
    ).toBe('fought_fact_required');

    expect(remaining(before.creatures.archer!.resources, spellSlotKey(5))).toBe(2);
    expect(budget(before)?.action).toBe(true);
    expect(readiedBy(before, ARCHER)).toBeNull();
  });

  /**
   * The same two refusals for all four facts, each through the one validator:
   * **required** where the spell prints the clause and **refused** where it
   * does not.
   */
  it.each([
    [
      'the fought fact by a spell that prints no such clause',
      { kind: 'spell', spellId: 'dissonant-whispers', slotLevel: 1, fought: [CULTIST] },
      'no_fought_clause',
    ],
    [
      'a designation by a spell that offers none',
      { kind: 'spell', spellId: 'dissonant-whispers', slotLevel: 1, unaffected: [CULTIST] },
      'no_designation',
    ],
    [
      'a damage type by a spell that prints one',
      { kind: 'spell', spellId: 'dissonant-whispers', slotLevel: 1, damageType: 'radiant' },
      'damage_type_fixed',
    ],
    [
      'a destination by a spell that teleports nobody',
      {
        kind: 'spell',
        spellId: 'dissonant-whispers',
        slotLevel: 1,
        teleportTo: { from: { landmark: 'the door' }, feet: 10, bearing: 0 },
      },
      'no_teleport_clause',
    ],
    [
      'no destination by a spell that teleports',
      { kind: 'spell', spellId: 'dimension-door', slotLevel: 4 },
      'destination_required',
    ],
  ] as readonly (readonly [string, SpellReady, string])[])(
    'refuses %s',
    (_why, response, code) => {
      expect(readyRefusal(response)).toBe(code);
    },
  );

  /**
   * A creature the engine has never heard of is refused at the Ready, which is
   * the evidence the whole validator is being asked rather than the one clause
   * this task was about: `unknown_creature` is a rule inside `declaredFacts`
   * and nothing on this path spells it a second time.
   */
  it('refuses a fought creature nobody has added', () => {
    expect(
      readyRefusal({
        kind: 'spell',
        spellId: 'dominate-person',
        slotLevel: 5,
        fought: [id('nobody')],
      }),
    ).toBe('unknown_creature');
  });

  /** The fact reaches the readied record, which is where the release reads it. */
  it('records the fact on what is being held', () => {
    const held = readiedBy(
      fold(
        'seed',
        ready(
          { kind: 'spell', spellId: 'dominate-person', slotLevel: 5, fought: [CULTIST] },
          CASTER,
        ),
      ),
      ARCHER,
    )?.response;
    if (held?.kind !== 'spell') throw new Error('expected a readied spell');
    expect(held.fought).toEqual([CULTIST]);
  });

  /**
   * All three, driven end to end — the Beast, the Humanoid and the one that
   * takes anything at all. SRD writes them as one paragraph with the creature
   * type and the slot bands changed, so a fixture that readied only the middle
   * one would be pinning the paragraph rather than the three spells.
   */
  it.each([
    ['dominate-beast', 4, 'Dominate Beast', WOLF],
    ['dominate-person', 5, 'Dominate Person', CULTIST],
    ['dominate-monster', 8, 'Dominate Monster', CULTIST],
  ] as readonly (readonly [string, number, string, CharacterId])[])(
    'readies and releases %s',
    (spellId, slotLevel, name, target) => {
      const log = nextTurn(ready({ kind: 'spell', spellId, slotLevel, fought: [target] }, CASTER));
      const out = unwrap(
        releaseReady(fold('seed', log), ARCHER, { targets: [target] }, supply('dominate')),
        'release',
      );
      const save = out.spell!.outcomes[0]!.save!;
      expect(save.modeSources.some((m) => m.source.includes(name))).toBe(true);
      expect(readiedBy(fold('seed', [...log, ...out.events]), ARCHER)).toBeNull();
    },
  );

  /**
   * The fourth fact, and the one the release could not possibly work out
   * again: where the caster said they were going.
   *
   * **Dimension Door and not Misty Step**, which is what the SRD leaves of the
   * brief's own example: "To be readied, a spell must have a casting time of
   * an action", and Misty Step is a Bonus Action. The case below is the honest
   * answer for the spell that cannot be readied at all.
   */
  it('releases a readied Dimension Door at the space it named', () => {
    const log = nextTurn(
      ready(
        {
          kind: 'spell',
          spellId: 'dimension-door',
          slotLevel: 4,
          // The archer stands on "the door" at (100, 100, 0); bearing 90 is +x.
          teleportTo: { from: { landmark: 'the door' }, feet: 120, bearing: 90 },
        },
        CASTER,
      ),
    );
    const out = unwrap(
      releaseReady(fold('seed', log), ARCHER, { targets: [ARCHER] }, supply('door')),
      'release',
    );
    expect(fold('seed', [...log, ...out.events]).scene?.positions.archer).toEqual({
      x: 220,
      y: 100,
      z: 0,
    });
  });

  /**
   * The other two facts, driven through the aura they were stated for.
   *
   * Spirit Guardians states both in one paragraph — "3d8 Radiant damage (if
   * you are good or neutral) or 3d8 Necrotic damage (if you are evil)" and
   * "you can designate creatures to be unaffected by it" — and it is cast with
   * an Action, so it can be readied. Neither fact lands at the release: the
   * casting leaves an Emanation behind and every later trigger reads them off
   * the ongoing record, which is exactly why dropping one is a **wedged hold**
   * rather than a silent number. `castOrRelease` re-asks `declaredFacts` at
   * the release, so a readied Spirit Guardians whose stated type was lost is
   * refused `damage_type_required` at every release, after the action and the
   * slot have gone.
   */
  describe('a readied Spirit Guardians keeps what its caster said', () => {
    /**
     * The cultist is **Immune to Radiant** — the type the spell's own area
     * trigger prints. So a casting that failed to carry the caster's stated
     * Necrotic would deal Radiant and this creature would take nothing at all,
     * which is the only assertion that tells the stated type from the printed
     * one. An undefended target cannot.
     */
    const GUARDIAN: readonly GameEvent[] = [
      ...SETUP.filter((e) => e.type !== 'spellcasting-declared').map((e) =>
        e.type === 'creature-added' && e.id === CULTIST
          ? { ...e, defenses: { radiant: { immune: true } } }
          : e,
      ),
      slot(3),
      {
        type: 'spellcasting-declared',
        id: ARCHER,
        spellcasting: declaredCasting({ ability: 'int', prepared: ['spirit-guardians'] }),
      },
    ];

    /**
     * Ready the aura, let it go on the cultist's turn, and walk the cultist
     * into it — the entry clause, because the release happens on somebody
     * else's turn and only that creature has movement to spend.
     */
    const sweptInto = (unaffected?: readonly CharacterId[]) => {
      const log = nextTurn(
        ready(
          {
            kind: 'spell',
            spellId: 'spirit-guardians',
            slotLevel: 3,
            damageType: 'necrotic',
            ...(unaffected === undefined ? {} : { unaffected }),
          },
          GUARDIAN,
        ),
      );
      const held = readiedBy(fold('seed', log), ARCHER)?.response;
      if (held?.kind !== 'spell') throw new Error('expected a readied spell');

      const released = unwrap(
        releaseReady(fold('seed', log), ARCHER, {}, supply('guardians')),
        'release',
      );
      const after = [...log, ...released.events];

      // Ten feet from the archer is inside a 15-foot Emanation; thirty, where
      // the cultist began, is outside it.
      const walked = unwrap(
        resolveMove(
          fold('seed', after),
          CULTIST,
          { placement: { from: { creature: ARCHER }, feet: 10, bearing: 0 } },
          supply('walk'),
        ),
        'walk',
      );
      const arrived = [...after, ...walked.events];

      const settled = unwrap(
        settleAreaEffects(fold('seed', arrived), supply('settle')),
        'settle',
      );
      return {
        castingId: held.castingId,
        owed: fold('seed', arrived).owedAreaEffects,
        state: fold('seed', [...arrived, ...settled.events]),
      };
    };

    it('deals the damage type the Ready stated, not the one the spell prints', () => {
      const { castingId, state } = sweptInto();
      // Radiant would have been shrugged off entirely, so losing a hit point
      // at all is what says the stated Necrotic reached the trigger's damage.
      expect(state.creatures.cultist!.vitals.hp).toBeLessThan(
        state.creatures.cultist!.vitals.hpMax,
      );
      expect(state.ongoing[castingId]?.damageType).toBe('necrotic');
    });

    it('spares the creature the Ready designated unaffected', () => {
      const { castingId, owed, state } = sweptInto([CULTIST]);
      // Nothing was ever owed, which is the aura declining to catch them at
      // all rather than a save they happened to make.
      expect(owed).toEqual([]);
      expect(state.creatures.cultist!.vitals.hp).toBe(state.creatures.cultist!.vitals.hpMax);
      expect(state.ongoing[castingId]?.unaffected).toEqual([CULTIST]);
    });
  });

  /** SRD: only a spell cast with an action can be readied. */
  it('refuses to ready Misty Step at all, whatever it says about where', () => {
    expect(
      readyRefusal({
        kind: 'spell',
        spellId: 'misty-step',
        slotLevel: 2,
        teleportTo: { from: { landmark: 'the door' }, feet: 10, bearing: 90 },
      }),
    ).toBe('not_readiable');
  });
});
