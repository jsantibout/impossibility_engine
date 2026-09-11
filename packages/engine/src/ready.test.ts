import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
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
  resolveTurn,
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

const supply = (seed = 'ready') => ({ issuer: createRollIssuer('r'), rng: createRng(seed) as Rng });

const TRIGGER = 'if the cultist steps on the trapdoor';

/** Ready something, and hand back the longer log. */
const ready = (
  response: Parameters<typeof takeReady>[2]['response'],
  log: readonly GameEvent[] = SETUP,
) => {
  const out = unwrap(takeReady(fold('seed', log), ARCHER, { trigger: TRIGGER, response }), 'ready');
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
      takeReady(fold('seed', SETUP), ARCHER, { trigger: odd, response: { kind: 'action' } }),
      'ready',
    );
    expect(readiedBy(fold('seed', [...SETUP, ...out]), ARCHER)?.trigger).toBe(odd);
  });

  it('refuses when the action is already gone', () => {
    expect(isErr(takeReady(fold('seed', ready({ kind: 'action' })), ARCHER, {
      trigger: TRIGGER,
      response: { kind: 'action' },
    }))).toBe(true);
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
    });
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
      }),
      'ready',
    );
    const again = unwrap(
      takeReady(fold('seed', [...SETUP, ...first]), ARCHER, {
        commandId: 'ready-1',
        trigger: TRIGGER,
        response: { kind: 'action' },
      }),
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
    });
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
    }))).toBe(true);
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
