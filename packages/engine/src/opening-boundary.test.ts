import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import type { Point } from './positioning.js';
import { declaredCasting } from './spellcasting.js';
import type { CombatantInput } from './combat.js';
import {
  beginCombat,
  mayAct,
  owedAreaEffectsOf,
  resolveSpell,
  resolveTurn,
  rollInitiativeAndBeginCombat,
  settleAreaEffects,
} from './commands.js';

/**
 * The boundary a fight opens on.
 *
 * `startCombat` has said it in a comment of its own since the beginning — "the
 * first combatant's turn starts with the fight" — and for a long time nothing
 * acted on it: the fold raised a start-of-turn boundary when one turn handed
 * over to the next, and never when the first turn arrived. So a creature that
 * had been standing in a Web since before anybody rolled Initiative began the
 * fight in it and saved against nothing, and the same moment's other
 * consequence — a casting's per-turn payout — was missed with it.
 *
 * Both halves are one SRD sentence apiece and one moment of the engine's. The
 * area half is fixed here; the payout half is not, and the reason is written
 * down at the foot of this file rather than left to be rediscovered.
 *
 * Web is the spell throughout because it is the book's plainest start-of-turn
 * area — "each creature that starts its turn in the webs" — and because its
 * entry clause is capped separately from its boundary clause, so a fix that
 * confused the two moments would show up here.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const VICTIM = id('victim'); // first in the order, and standing in the webs
const BYSTANDER = id('bystander'); // also in the webs, but not up first

const sheet = (): CharacterSheet => ({
  level: 11,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

/** The geometry `area-triggers.test.ts` works against: a 20-foot Cube laid along +x. */
const HALL: Point = { x: 200, y: 200, z: 0 };
const CUBE: Point = { x: 250, y: 200, z: 0 };
const TOWARDS: Point = { x: 300, y: 200, z: 0 };

const spot = (name: string, at: Point): GameEvent => ({ type: 'landmark-added', name, at });
const place = (who: CharacterId, name: string): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { landmark: name }, feet: 0 },
});

const SETUP: readonly GameEvent[] = [
  added(CASTER),
  added(VICTIM),
  added(BYSTANDER),
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['web', 'heroism'] }),
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CASTER,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 900, depth: 900, height: 60 } },
  spot('the hall', HALL),
  spot('in the webs', { x: 260, y: 200, z: 0 }),
  spot('beside the webs', { x: 264, y: 200, z: 0 }),
  place(CASTER, 'the hall'),
  place(VICTIM, 'in the webs'),
  place(BYSTANDER, 'beside the webs'),
];

/** A penalty big enough that every save fails, so a trigger that fired shows. */
const supply = (seed = 'opening', flat = -40) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  bonuses: [{ source: 'the fixture', flat }],
});

const must = <T,>(result: Result<T>, what: string): T => unwrap(result, what);

/** Cast the Web before anybody rolls Initiative, which is the whole premise. */
const webbed = (): GameEvent[] => {
  const log = [...SETUP];
  const out = must(
    resolveSpell(
      fold('seed', log),
      CASTER,
      { spellId: 'web', targets: [], at: CUBE, towards: TOWARDS },
      supply('web'),
    ),
    'casting Web',
  );
  log.push(...out.events);
  return log;
};

/** Initiative: the victim first, so the fight opens on its turn. */
const FIGHT: GameEvent = {
  type: 'combat-started',
  combatants: [
    { id: VICTIM, initiative: 30, speed: 30 },
    { id: BYSTANDER, initiative: 20, speed: 30 },
    { id: CASTER, initiative: 10, speed: 30 },
  ],
};

const owedAgainst = (state: GameState, who: CharacterId) =>
  owedAreaEffectsOf(state).filter((owed) => owed.target === who);

const settle = (log: GameEvent[], seed = 'settle'): GameEvent[] => {
  const out = must(settleAreaEffects(fold('seed', log), supply(seed)), 'settling');
  log.push(...out.events);
  return log;
};

/** Advance one turn, appending whatever the boundary did. */
const advance = (log: GameEvent[], seed = 'turn'): GameEvent[] => {
  const out = must(resolveTurn(fold('seed', log), supply(seed)), 'advancing the turn');
  log.push(...out.events);
  return log;
};

/** How many times this creature has been caught at the start of one of its turns. */
const caughtAtStart = (log: readonly GameEvent[], who: CharacterId): number =>
  log.filter(
    (event) =>
      event.type === 'area-effect-settled' &&
      event.target === who &&
      event.moment === 'start-of-turn',
  ).length;

const restrained = (state: GameState, who: CharacterId): boolean =>
  state.creatures[who]?.conditions.conditions.includes('restrained') ?? false;

describe('a fight that opens on a start-of-turn area', () => {
  it('catches the creature whose turn the fight begins on', () => {
    const log = webbed();
    // Nothing owed before the fight: outside an Initiative order there are no
    // turns, so the boundary the spell names has not arrived.
    expect(owedAreaEffectsOf(fold('seed', log))).toEqual([]);

    log.push(FIGHT);
    expect(owedAgainst(fold('seed', log), VICTIM)).toEqual([
      { castingId: expect.any(String), target: VICTIM, moment: 'start-of-turn' },
    ]);
  });

  /** And nobody else's: exactly one creature's turn starts when the fight does. */
  it('leaves a creature standing in the same area but not up first alone', () => {
    const log = webbed();
    log.push(FIGHT);
    expect(owedAgainst(fold('seed', log), BYSTANDER)).toEqual([]);
    expect(owedAgainst(fold('seed', log), CASTER)).toEqual([]);
  });

  /**
   * The debt is a debt like any other: the creature it is owed against may not
   * act until it is settled, and settling it is the spell's own save, rolled
   * by the engine at the level the casting was made with.
   */
  it('makes the opening creature settle before it acts, and deals the spell', () => {
    const log = webbed();
    log.push(FIGHT);
    expect(mayAct(fold('seed', log), VICTIM)).not.toBeNull();

    settle(log);
    const state = fold('seed', log);
    expect(owedAreaEffectsOf(state)).toEqual([]);
    expect(mayAct(state, VICTIM)).toBeNull();
    // SRD Web: "each creature that starts its turn in the webs must succeed on
    // a Dexterity saving throw or have the Restrained condition." The fixture's
    // penalty makes it fail.
    expect(restrained(state, VICTIM)).toBe(true);
    expect(restrained(state, BYSTANDER)).toBe(false);
  });

  /**
   * The failure mode a fix of this shape produces, tested directly.
   *
   * The opening boundary must fire **once**: once as the fight starts, and not
   * again when that first turn is reached by some other way. What keeps them
   * apart is that there is no other way to it — `turnsTaken` starts at 0 and
   * only grows, and the stamp an area trigger writes is per turn — so this
   * counts the settlements in the log rather than looking for the debt, which
   * `resolveTurn` discharges as it passes.
   */
  it('catches the opening creature once, and again only on its next turn', () => {
    const log = webbed();
    log.push(FIGHT);
    expect(owedAgainst(fold('seed', log), VICTIM)).toHaveLength(1);

    settle(log);
    expect(owedAreaEffectsOf(fold('seed', log))).toEqual([]);
    expect(caughtAtStart(log, VICTIM)).toBe(1);

    // Round the table back to the victim: the bystander's turn, the caster's,
    // and the victim's again — a *different* turn, which catches it once more.
    advance(log, 'a');
    expect(caughtAtStart(log, VICTIM)).toBe(1);
    advance(log, 'b');
    expect(caughtAtStart(log, VICTIM)).toBe(1);
    advance(log, 'c');

    const state = fold('seed', log);
    expect(state.combat?.turnIndex).toBe(0);
    expect(state.combat?.turnsTaken).toBe(3);
    expect(caughtAtStart(log, VICTIM)).toBe(2);
  });

  /**
   * And the log means one thing: the reduce is the fold, so a session that
   * stepped the events as they happened and a replay that folds them from cold
   * reach the same state.
   */
  it('replays to the state it was played to', () => {
    const log = webbed();
    log.push(FIGHT);
    settle(log);
    advance(log);
    expect(fold('seed', log)).toEqual(log.reduce(applyEvent, fold('seed', [])));
  });
});

describe('a fight that opens on a payout', () => {
  /**
   * **The other half of the same moment, and the same sentence of the SRD's.**
   *
   * Heroism pays "at the start of each of its turns", so a creature holding
   * the casting when the fight opens is owed the very moment the Web above
   * raises — and for as long as the Web half was broken this one was too. The
   * two are one bug; they are not one repair, because the engine holds the two
   * kinds of debt differently:
   *
   * | | an area trigger | a payout |
   * |---|---|---|
   * | What the fold does at the moment | files a debt (`owedAreaEffects`) | nothing; the arrangement is already on the creature |
   * | What settles it | `settleAreaEffects`, a command carrying a generator | the boundary command itself |
   *
   * A payout is deliberately not a debt — see {@link GrantedPayout} — because
   * the boundary command reads it and pays it in one breath, so nothing is
   * ever owed between turns. Filing one at this single moment would have made
   * it a second kind of debt beside `owedAreaEffects`, raised in one place and
   * settled by a command that settles nothing else. So `beginCombat` took what
   * `resolveTurn` already had instead: the **optional** `Supply`, and the
   * `payout_owed` refusal in the same words under the same code. A fight
   * opening on a creature that is owed a payout pays it, or refuses for want
   * of a generator to settle it with.
   *
   * **Optional, and that is the load-bearing word.** Most fights open on
   * nobody who is owed anything, and a caller with no payout in the room must
   * not be made to carry the book to start a fight — which is also why every
   * caller that passed no `Supply` before still passes none.
   */
  const heroic = (): GameEvent[] => {
    const log = [...SETUP];
    const cast = must(
      resolveSpell(
        fold('seed', log),
        CASTER,
        { spellId: 'heroism', targets: [CASTER], slotLevel: 1 },
        supply('heroism'),
      ),
      'casting Heroism',
    );
    log.push(...cast.events);
    return log;
  };

  /** The caster first, so the fight opens on the turn Heroism names. */
  const OPENS_ON_CASTER: readonly CombatantInput[] = [
    { id: CASTER, initiative: 30, speed: 30 },
    { id: VICTIM, initiative: 10, speed: 30 },
  ];

  /** How many times this creature has actually been handed the payout. */
  const paidTo = (log: readonly GameEvent[], who: CharacterId): number =>
    log.filter((event) => event.type === 'temporary-hp-granted' && event.id === who).length;

  const tempHp = (log: readonly GameEvent[], who: CharacterId): number =>
    fold('seed', log).creatures[who]?.vitals.temporaryHp ?? 0;

  it('pays it at the opening boundary, and pays it once', () => {
    const log = heroic();

    // The arrangement is on the caster, and the fight is about to open on the
    // caster's turn — so this is the moment Heroism names.
    const holding = fold('seed', log);
    expect(holding.creatures[CASTER]?.payouts).toHaveLength(1);
    expect(holding.creatures[CASTER]?.payouts[0]?.at).toBe('start-of-turn');
    expect(tempHp(log, CASTER)).toBe(0);

    log.push(
      ...must(
        beginCombat(fold('seed', log), OPENS_ON_CASTER, {}, supply('open')),
        'opening the fight',
      ),
    );

    // SRD Heroism: "that creature gains Temporary Hit Points equal to your
    // spellcasting ability modifier" — Wisdom 18, so four, and they are there
    // the moment the fight opens.
    expect(tempHp(log, CASTER)).toBe(4);
    expect(paidTo(log, CASTER)).toBe(1);

    // And the next one still arrives the ordinary way: the caster's turn ends,
    // the victim's begins owing nothing, and the caster's second turn is paid
    // for once — not once more for the turn the opening already paid.
    advance(log, 'p1');
    expect(paidTo(log, CASTER)).toBe(1);
    advance(log, 'p2');
    expect(paidTo(log, CASTER)).toBe(2);
    expect(tempHp(log, CASTER)).toBe(4);
  });

  /**
   * The refusal `resolveTurn` already gives at the same moment, in the same
   * words: a boundary that owes a payout and has no generator to settle it
   * says so rather than passing it by. A refusal emits nothing, so the fight
   * has not started and the caller opens it again with the content.
   */
  it('refuses to open with no Supply, and starts no fight', () => {
    const log = heroic();
    const refused = beginCombat(fold('seed', log), OPENS_ON_CASTER);

    expect(refused.ok).toBe(false);
    if (isErr(refused)) expect(refused.code).toBe('payout_owed');
    expect(fold('seed', log).combat).toBeNull();
  });

  /** And an opening that owes nothing is exactly what it always was. */
  it('opens a fight nobody is owed anything at with no Supply at all', () => {
    const log = [...SETUP];
    const opened = must(beginCombat(fold('seed', log), OPENS_ON_CASTER), 'opening the fight');

    expect(opened.map((event) => event.type)).toEqual(['combat-started']);
    log.push(...opened);
    expect(fold('seed', log).combat?.turnsTaken).toBe(0);
  });

  /**
   * The whole path, not the inner command alone: a caller that rolls
   * Initiative and starts the fight in one breath arrives at the same
   * boundary, and a payout only `beginCombat` paid would be missed by the
   * command most callers reach for.
   *
   * The caster's place in the order is bought rather than hoped for — the dice
   * decide it, and a test that needed a particular creature to win the roll
   * would be a test of the seed.
   */
  it('pays through the command that rolls Initiative too', () => {
    const log = heroic();
    const entrants = [
      { id: CASTER, speed: 30, options: { bonuses: [{ source: 'the fixture', flat: 100 }] } },
      { id: VICTIM, speed: 30 },
    ];

    log.push(
      ...must(
        rollInitiativeAndBeginCombat(fold('seed', log), entrants, supply('rolled')),
        'rolling and opening',
      ),
    );

    expect(fold('seed', log).combat?.order[0]?.id).toBe(CASTER);
    expect(tempHp(log, CASTER)).toBe(4);
    expect(paidTo(log, CASTER)).toBe(1);
  });

  /** And refuses through it, emitting nothing — including the rolls it threw. */
  it('refuses through it with no content, and records no Initiative', () => {
    const log = heroic();
    const entrants = [
      { id: CASTER, speed: 30, options: { bonuses: [{ source: 'the fixture', flat: 100 }] } },
      { id: VICTIM, speed: 30 },
    ];
    const bare = { issuer: createRollIssuer('r'), rng: createRng('rolled') as Rng };

    const refused = rollInitiativeAndBeginCombat(fold('seed', log), entrants, bare);

    expect(refused.ok).toBe(false);
    if (isErr(refused)) expect(refused.code).toBe('payout_owed');
    expect(fold('seed', log).combat).toBeNull();
  });
});
