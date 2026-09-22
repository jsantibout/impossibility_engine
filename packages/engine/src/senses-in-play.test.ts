import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { spellSlotKey } from './resources.js';
import {
  eligibleTargets,
  resolveAttack,
  relocateCreature,
  resolveMove,
  resolveSpell,
  resolveTurn,
  takeDodge,
} from './commands.js';
import { offersForDamage, type ReactionFeature } from './reactions.js';
import { enemyWithinFiveFeet } from './commands/rolls.js';

/**
 * A sense reaching the table.
 *
 * Senses landed as a reader and a seam and nothing consulted them: `sensesOf`
 * derived a creature's Darkvision off the sheet, `canSee` put it together
 * with the scene, and every command in the engine went on asking
 * `sightBetween` with no senses at all — so a Dwarf in the dark was as blind
 * as anybody, and a species trait the catalogue had transcribed did nothing
 * in play. This routes the sense through every rule that asks the sight
 * question.
 *
 * Two things are asserted about each of them, because neither is obvious from
 * the call:
 *
 * 1. **Whose senses.** The looker is not always the actor. A casting reads the
 *    *caster's*; Dodge's "if you can see the attacker" reads the *target's*;
 *    an Opportunity Attack and a Reaction feature read the *reactor's*. Every
 *    case below is built so that reading the other creature's senses would
 *    give the opposite answer.
 * 2. **A declaration still wins.** The sense may only answer where nobody has
 *    said anything, in both directions: a declared no inside the range is
 *    obeyed, and a declared yes beyond it is too.
 *
 * Distances throughout are 55 and 65 feet against a Darkvision of 60, which
 * is the pair either side of the one comparison the range is.
 */

const id = (s: string) => asCharacterId(s);
const SEER = id('seer');
const OTHER = id('other');

const DARKVISION_60 = {
  feature: 'a-species:a-trait',
  name: 'Darkvision',
  reach: { kind: 'self' },
  grant: { kind: 'sense', sense: 'darkvision', feet: 60 },
} as const;

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 14, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
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

const added = (
  who: CharacterId,
  side: string,
  over: Partial<CharacterSheet> = {},
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

/** Darkvision on whichever creature the case is about, and on nobody else. */
const WITH_SENSE: Partial<CharacterSheet> = { standing: [DARKVISION_60] };

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/**
 * A scene with two creatures a stated distance apart and **nothing declared
 * about sight**, so every answer below is the sense's or nobody's.
 */
const apart = (
  feet: number,
  sees: CharacterId | null,
  extra: readonly GameEvent[] = [],
): readonly GameEvent[] => [
  added(SEER, 'party', sees === SEER ? WITH_SENSE : {}),
  added(OTHER, 'ogres', sees === OTHER ? WITH_SENSE : {}),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the well', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: SEER, placement: { from: { landmark: 'the well' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: OTHER,
    placement: { from: { creature: SEER }, feet, bearing: 90 },
  },
  ...extra,
];

// — a casting reads the caster's senses ————————————————————————————————————

/**
 * SRD Blindness/Deafness: Range 120 feet, "one creature that you can see
 * within range". The range is twice the Darkvision, which is the reason this
 * is the spell driven here: at 65 feet the target is well inside the spell
 * and outside the sense, so the two questions cannot be confused.
 */
const CASTING: readonly GameEvent[] = [
  {
    type: 'spellcasting-declared',
    id: SEER,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['blindness-deafness'] }),
  },
  {
    type: 'resource-pool-declared',
    id: SEER,
    pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 4, recovers: 'long-rest' },
  },
];

const blind = (log: readonly GameEvent[]) =>
  resolveSpell(
    fold('seed', log),
    SEER,
    // "(your choice)", stated because the spell insists on it. Blinded, which
    // is the spell's own name for what this file is about.
    { spellId: 'blindness-deafness', targets: [OTHER], slotLevel: 2, choice: 'blinded' },
    supply('blind'),
  );

describe('a casting asks the sight question with the caster’s senses', () => {
  it('reaches a target 55 feet off with nobody having declared anything', () => {
    const out = unwrap(blind(apart(55, SEER, CASTING)), 'blindness at 55');
    expect(out.outcomes[0]?.target).toBe(OTHER);
  });

  it('still asks about one 65 feet off', () => {
    const out = blind(apart(65, SEER, CASTING));
    expect(isErr(out) && out.code).toBe('needs_context');
    expect(isErr(out) && out.reason).toContain('can see');
  });

  /**
   * Whose senses, asserted by the case that would flip: the Darkvision is on
   * the *target* and the caster has none. Reading the target's senses would
   * land the spell; reading the caster's asks.
   */
  it('does not let the target’s Darkvision answer for the caster', () => {
    const out = blind(apart(55, OTHER, CASTING));
    expect(isErr(out) && out.code).toBe('needs_context');
  });

  it('obeys a declared no inside the sense’s range', () => {
    const out = blind(
      apart(55, SEER, [...CASTING, { type: 'sight-declared', from: SEER, to: OTHER, seen: false }]),
    );
    expect(isErr(out) && out.code).toBe('cannot_see_target');
  });

  it('obeys a declared yes beyond it', () => {
    const out = unwrap(
      blind(
        apart(65, SEER, [
          ...CASTING,
          { type: 'sight-declared', from: SEER, to: OTHER, seen: true },
        ]),
      ),
      'declared at 65',
    );
    expect(out.outcomes[0]?.target).toBe(OTHER);
  });
});

describe('the shortlist reads the same senses the casting does', () => {
  const shortlist = (feet: number, sees: CharacterId | null) =>
    eligibleTargets(
      fold('seed', apart(feet, sees, CASTING)),
      SRD_CONTENT,
      SEER,
      'blindness-deafness',
      2,
    );

  it('lists a target the caster’s Darkvision reaches', () => {
    expect(shortlist(55, SEER).eligible).toEqual([OTHER]);
  });

  it('asks about one beyond it', () => {
    const out = shortlist(65, SEER);
    expect(out.eligible).toEqual([]);
    expect(out.needsContext.map((n) => n.kind)).toEqual(['visibility']);
  });

  /** And the sense is the looker's: the target's does not put them on the list. */
  it('does not let the target’s Darkvision list them', () => {
    expect(shortlist(55, OTHER).eligible).toEqual([]);
  });
});

// — Dodge reads the *target's* senses ——————————————————————————————————————

/**
 * SRD Dodge: "any attack roll made against you has Disadvantage **if you can
 * see the attacker**." The looker is the creature Dodging — the one being
 * rolled against — and not the one rolling, which is the one place in the
 * engine where the sight question runs against the direction of the action.
 */
describe('Dodge asks whether the dodger can see the attacker', () => {
  const ARCHER = OTHER;
  const DODGER = SEER;

  const swing = (feet: number, sees: CharacterId | null) => {
    const base: readonly GameEvent[] = [
      ...apart(feet, sees, [
        { type: 'items-gained', id: ARCHER, items: [{ id: 'shortbow', quantity: 1 }], source: 'kit' },
        {
          type: 'combat-started',
          combatants: [
            { id: DODGER, initiative: 20, speed: 30 },
            { id: ARCHER, initiative: 10, speed: 30 },
          ],
        },
      ]),
    ];
    const dodged = [...base, ...unwrap(takeDodge(fold('seed', base), DODGER, {}), 'dodge')];
    const passed = [
      ...dodged,
      ...unwrap(resolveTurn(fold('seed', dodged), supply('turn')), 'turn').events,
    ];
    return unwrap(
      resolveAttack(
        fold('seed', passed),
        ARCHER,
        { target: DODGER, weapon: 'shortbow' },
        supply('swing'),
      ),
      'attack',
    );
  };

  const sightNote = (unverified: readonly string[]) =>
    unverified.filter((u) => u.includes('can see the creature rolling'));

  it('applies the Disadvantage without a caveat when the dodger’s Darkvision reaches', () => {
    const out = swing(55, DODGER);
    expect(out.attack!.mode).toBe('disadvantage');
    expect(sightNote(out.unverified)).toEqual([]);
  });

  /**
   * Beyond the sense the clause is unchecked again: the benefit is applied —
   * the direction every undeclared sight line in the engine takes — and the
   * caveat says so.
   */
  it('still reports the clause unchecked beyond the sense', () => {
    const out = swing(65, DODGER);
    expect(out.attack!.mode).toBe('disadvantage');
    expect(sightNote(out.unverified)).toHaveLength(1);
  });

  /**
   * Whose senses: the Darkvision is on the archer, and it is the dodger who
   * has to see. Reading the roller's senses would silence the caveat.
   */
  it('does not let the attacker’s Darkvision settle the dodger’s clause', () => {
    const out = swing(55, ARCHER);
    expect(sightNote(out.unverified)).toHaveLength(1);
  });

  it('obeys a declared no inside the range, and drops the Disadvantage', () => {
    const base: readonly GameEvent[] = apart(55, DODGER, [
      { type: 'items-gained', id: ARCHER, items: [{ id: 'shortbow', quantity: 1 }], source: 'kit' },
      { type: 'sight-declared', from: DODGER, to: ARCHER, seen: false },
      {
        type: 'combat-started',
        combatants: [
          { id: DODGER, initiative: 20, speed: 30 },
          { id: ARCHER, initiative: 10, speed: 30 },
        ],
      },
    ]);
    const dodged = [...base, ...unwrap(takeDodge(fold('seed', base), DODGER, {}), 'dodge')];
    const passed = [
      ...dodged,
      ...unwrap(resolveTurn(fold('seed', dodged), supply('turn')), 'turn').events,
    ];
    const out = unwrap(
      resolveAttack(
        fold('seed', passed),
        ARCHER,
        { target: DODGER, weapon: 'shortbow' },
        supply('swing'),
      ),
      'attack',
    );
    expect(out.attack!.mode).toBe('normal');
  });
});

// — an Opportunity Attack reads the reactor's senses ———————————————————————

/**
 * SRD Opportunity Attack: "a creature **that you can see** leaves your
 * reach." The looker is the creature who would swing, and the distance the
 * sense has to cover is the reach it is swinging at — five feet, which every
 * Darkvision covers. So the assertion is not about the range but about
 * *whose*: with the sense on the reactor the clause is settled, and with it
 * on the mover it is not.
 */
describe('an Opportunity Attack asks whether the reactor can see the mover', () => {
  const MOVER = OTHER;
  const REACTOR = SEER;

  const walkAway = (sees: CharacterId | null) => {
    const log: readonly GameEvent[] = apart(5, sees, [
      {
        type: 'combat-started',
        combatants: [
          { id: MOVER, initiative: 20, speed: 30 },
          { id: REACTOR, initiative: 10, speed: 30 },
        ],
      },
    ]);
    return unwrap(
      resolveMove(
        fold('seed', log),
        MOVER,
        { placement: { from: { creature: REACTOR }, feet: 25, bearing: 90 } },
        supply('walk'),
      ),
      'move',
    );
  };

  const sightNote = (unverified: readonly string[]) =>
    unverified.filter((u) => u.includes('whether') && u.includes('can see'));

  it('offers it with no caveat when the reactor’s Darkvision reaches the mover', () => {
    const out = walkAway(REACTOR);
    expect(sightNote(out.unverified)).toEqual([]);
  });

  it('reports the clause unchecked when nobody can see by sense or declaration', () => {
    const out = walkAway(null);
    expect(sightNote(out.unverified)).toHaveLength(1);
  });

  /** Whose senses: the mover's Darkvision is no help to the creature swinging. */
  it('does not let the mover’s Darkvision settle the reactor’s clause', () => {
    const out = walkAway(MOVER);
    expect(sightNote(out.unverified)).toHaveLength(1);
  });
});

// — a Reaction feature reads the reactor's senses ——————————————————————————

/**
 * SRD Cutting Words: "a creature **that you can see** within 60 feet". The
 * reach is written wider here than the sense so that the two bounds can be
 * told apart: the feature reaches ninety feet, the Darkvision sixty, and a
 * creature at sixty-five is inside one and outside the other.
 */
const CUTTING: ReactionFeature = {
  feature: 'a-college:cutting-words',
  name: 'Cutting Words',
  window: 'damage-rolled',
  costsReaction: true,
  pool: null,
  reach: { kind: 'within', feet: 90 },
  requiresSight: true,
  does: { kind: 'reduce-damage', amount: { dice: '1d6' } },
};

describe('a Reaction window asks whether the reactor can see whoever rolled', () => {
  const ROLLER = OTHER;
  const REACTOR = SEER;

  const offers = (feet: number, sees: CharacterId | null) =>
    offersForDamage(
      fold(
        'seed',
        apart(feet, sees).map((e) =>
          e.type === 'creature-added' && e.id === REACTOR
            ? { ...e, sheet: { ...e.sheet, reactions: [CUTTING] } }
            : e,
        ),
      ),
      { target: REACTOR, by: ROLLER, fromAttack: true, damageTypes: ['slashing'] },
    );

  it('offers it with no caveat inside the reactor’s Darkvision', () => {
    const out = offers(55, REACTOR);
    expect(out.offers.map((o) => o.feature)).toEqual([CUTTING.feature]);
    expect(out.unverified).toEqual([]);
  });

  it('offers it with the caveat beyond the sense but inside the reach', () => {
    const out = offers(65, REACTOR);
    expect(out.offers.map((o) => o.feature)).toEqual([CUTTING.feature]);
    expect(out.unverified).toHaveLength(1);
  });

  /** Whose senses: the roller's Darkvision does not let the Bard see them. */
  it('does not let the roller’s Darkvision settle it', () => {
    expect(offers(55, ROLLER).unverified).toHaveLength(1);
  });

  it('obeys a declared no inside the sense’s range and withholds the offer', () => {
    const log = apart(55, REACTOR, [
      { type: 'sight-declared', from: REACTOR, to: ROLLER, seen: false },
    ]).map((e) =>
      e.type === 'creature-added' && e.id === REACTOR
        ? { ...e, sheet: { ...e.sheet, reactions: [CUTTING] } }
        : e,
    );
    const out = offersForDamage(fold('seed', log), {
      target: REACTOR,
      by: ROLLER,
      fromAttack: true,
      damageTypes: ['slashing'],
    });
    expect(out.offers).toEqual([]);
  });
});

// — a teleport reads the teleporting creature's senses —————————————————————

/**
 * SRD Misty Step: "an unoccupied space **you can see**." The destination here
 * is measured from a creature, so the sight question is the teleporting
 * creature's view of that anchor.
 */
describe('a teleport asks whether the creature can see what the destination is measured from', () => {
  const hop = (feet: number, sees: CharacterId | null) =>
    relocateCreature(fold('seed', apart(feet, sees)), SEER, {
      placement: { from: { creature: OTHER }, feet: 5, bearing: 180 },
      within: 500,
      requiresSight: true,
    });

  it('goes where the mover’s Darkvision reaches', () => {
    expect(unwrap(hop(55, SEER), 'hop at 55').feet).toBeGreaterThan(0);
  });

  it('asks beyond it', () => {
    const out = hop(65, SEER);
    expect(isErr(out) && out.code).toBe('visibility');
  });

  /** Whose senses: the anchor's Darkvision does not show the mover anything. */
  it('does not let the anchor’s Darkvision answer', () => {
    expect(isErr(hop(55, OTHER))).toBe(true);
  });

  it('obeys a declared no inside the sense’s range', () => {
    const out = relocateCreature(
      fold(
        'seed',
        apart(55, SEER, [{ type: 'sight-declared', from: SEER, to: OTHER, seen: false }]),
      ),
      SEER,
      {
        placement: { from: { creature: OTHER }, feet: 5, bearing: 180 },
        within: 500,
        requiresSight: true,
      },
    );
    expect(isErr(out) && out.code).toBe('cannot_see_destination');
  });
});

// — the one rule a sense cannot move ———————————————————————————————————————

/**
 * SRD Ranged Attacks: Disadvantage "if you are within 5 feet of an enemy
 * **who can see you**". The sense reaches the looker here as it does
 * everywhere else, and it is worth saying out loud that it cannot change the
 * answer: the rule stands unless the enemy is *declared* unable to see, and a
 * sense only ever turns "nobody has said" into "yes" — which the rule already
 * treats the same way. Asserted rather than assumed, because a reader finding
 * the sense threaded through here would otherwise expect it to do something.
 */
describe('a sense cannot excuse a ranged attacker from the enemy beside them', () => {
  const near = (sees: CharacterId | null) => enemyWithinFiveFeet(fold('seed', apart(5, sees)), SEER);

  it('applies the rule whether the enemy has a sense or not', () => {
    expect(near(null).near).toBe(true);
    expect(near(OTHER).near).toBe(true);
  });

  it('is excused only by a declared no', () => {
    const state = fold(
      'seed',
      apart(5, OTHER, [{ type: 'sight-declared', from: OTHER, to: SEER, seen: false }]),
    );
    expect(enemyWithinFiveFeet(state, SEER).near).toBe(false);
  });
});
