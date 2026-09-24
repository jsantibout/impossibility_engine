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
  relocateCreature,
  resolveMove,
  resolveSpell,
  takeHide,
} from './commands.js';
import { offersForDamage, type ReactionFeature } from './reactions.js';
import { enemyWithinFiveFeet } from './commands/rolls.js';
import { canSee, canSeePoint, canSomehowSee } from './standing.js';

/**
 * SRD Blinded: "You can't see and automatically fail any ability check that
 * requires sight."
 *
 * The condition used to reach exactly one sight question — `areaTargets`
 * composed it beside `canSeePoint` for Hypnotic Pattern's "who can see the
 * pattern" — and every other rule that asks whether a creature can see went on
 * answering off the declaration and the senses alone. So a Blinded caster
 * targeted "a creature you can see", a Blinded teleporter picked "a space you
 * can see", a Blinded reactor swung an Opportunity Attack at "a creature that
 * you can see", and a Blinded dodger kept Dodge's "if you can see the
 * attacker". Each of those is the book's own sentence, and the answer to all
 * of them is no.
 *
 * **The ruling, and its one exception.** A Blinded creature answers no to
 * every sight question the engine asks of it *as the looker*, except where
 * SRD Blindsight reaches: it lets a creature "see within a specific range
 * without relying on physical sight", which is precisely the reliance the
 * condition removes. Darkvision and Truesight are sight and go dark with the
 * eyes.
 *
 * **The condition outranks a declared line.** A table that declared this
 * creature can see that one declared a fact about eyes that have since
 * stopped working; a declaration is for what the engine cannot know, and this
 * it knows.
 *
 * **A creature still sees itself.** That pair is answered before the
 * declaration, before cover and before any sense, because where a creature
 * stands relative to itself is the engine's fact rather than the table's —
 * `seeing-yourself.test.ts` is the whole of why — and a blind cleric may
 * still cast Healing Word on themselves.
 *
 * Every row of the table on `canSee` is driven below, through the command
 * that asks it.
 */

const id = (s: string) => asCharacterId(s);
const SEER = id('seer');
const OTHER = id('other');

const BLINDSIGHT_60 = {
  feature: 'a-species:a-trait',
  name: 'Blindsight',
  reach: { kind: 'self' },
  grant: { kind: 'sense', sense: 'blindsight', feet: 60 },
} as const;

const DARKVISION_60 = {
  feature: 'a-species:another-trait',
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

const added = (who: CharacterId, side: string, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

/** What the looker holds behind the ruined eyes, if anything. */
type Sense = 'none' | 'blindsight' | 'darkvision';

const senseOf = (sense: Sense): Partial<CharacterSheet> =>
  sense === 'none'
    ? {}
    : { standing: [sense === 'blindsight' ? BLINDSIGHT_60 : DARKVISION_60] };

const blinded = (who: CharacterId): GameEvent => ({
  type: 'condition-applied',
  id: who,
  condition: 'blinded',
  source: 'a faceful of sand',
});

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/**
 * Two creatures a stated distance apart with **nothing declared about sight**,
 * the looker Blinded unless the case says otherwise, and whichever sense the
 * case hangs on them.
 *
 * Distances are 55 and 65 feet against a sense of 60, which is the pair either
 * side of the one comparison the range is.
 */
const scene = (
  looker: CharacterId,
  feet: number,
  sense: Sense,
  { blind = true }: { blind?: boolean } = {},
  extra: readonly GameEvent[] = [],
): readonly GameEvent[] => [
  added(SEER, 'party', looker === SEER ? senseOf(sense) : {}),
  added(OTHER, 'ogres', looker === OTHER ? senseOf(sense) : {}),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the well', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: SEER, placement: { from: { landmark: 'the well' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: OTHER,
    placement: { from: { creature: SEER }, feet, bearing: 90 },
  },
  ...(blind ? [blinded(looker)] : []),
  ...extra,
];

// — the helper itself ——————————————————————————————————————————————————————

describe('the Blinded condition is the first thing the sight question reads', () => {
  it('answers no where nobody has declared anything', () => {
    expect(canSee(fold('seed', scene(SEER, 55, 'none')), SEER, OTHER)).toBe(false);
  });

  /**
   * And it is a **refusal** rather than homework: without the condition this
   * pair is `null`, which every caller turns into "go and ask the table". A
   * blind creature is not a fact anybody has to establish.
   */
  it('is a no rather than a null, which the same pair gives unblinded', () => {
    expect(canSee(fold('seed', scene(SEER, 55, 'none', { blind: false })), SEER, OTHER)).toBeNull();
  });

  it('outranks a declared line of sight', () => {
    const log = scene(SEER, 55, 'none', {}, [
      { type: 'sight-declared', from: SEER, to: OTHER, seen: true },
    ]);
    expect(canSee(fold('seed', log), SEER, OTHER)).toBe(false);
  });

  it('leaves Blindsight inside its range to answer, and not beyond it', () => {
    expect(canSee(fold('seed', scene(SEER, 55, 'blindsight')), SEER, OTHER)).toBe(true);
    expect(canSee(fold('seed', scene(SEER, 65, 'blindsight')), SEER, OTHER)).toBe(false);
  });

  /** Darkvision is sight, and goes dark with the eyes. */
  it('is not excepted by Darkvision', () => {
    expect(canSee(fold('seed', scene(SEER, 55, 'darkvision')), SEER, OTHER)).toBe(false);
    // The same sense, the same distance, the eyes working: true.
    expect(
      canSee(fold('seed', scene(SEER, 55, 'darkvision', { blind: false })), SEER, OTHER),
    ).toBe(true);
  });

  /** It is a fact about the looker, so it says nothing about the other end. */
  it('does not blind whoever is looking back', () => {
    const state = fold(
      'seed',
      scene(SEER, 55, 'darkvision', {}, [
        {
          type: 'sense-granted',
          id: OTHER,
          modifier: { source: 'a crystal eye', sense: 'darkvision', feet: 60 },
        },
      ]),
    );
    expect(canSee(state, SEER, OTHER)).toBe(false);
    expect(canSee(state, OTHER, SEER)).toBe(true);
  });

  /** A creature sees itself; that pair is not a sight question. */
  it('still lets a creature see itself', () => {
    expect(canSee(fold('seed', scene(SEER, 55, 'none')), SEER, SEER)).toBe(true);
  });

  /** Invisible's "if a creature can somehow see you" takes the same first step. */
  it('closes `canSomehowSee` too, and Blindsight excepts that one as well', () => {
    expect(canSomehowSee(fold('seed', scene(SEER, 55, 'none')), SEER, OTHER)).toBe(false);
    expect(canSomehowSee(fold('seed', scene(SEER, 55, 'blindsight')), SEER, OTHER)).toBe(true);
  });

  /**
   * **A Blindsight nobody can measure is homework, not blindness.**
   *
   * The exception is a range, and a range needs a distance. Where there is
   * none — a looker nobody has placed, or a template anchored on a corner
   * rather than a space — the condition has settled nothing about a creature
   * who holds Blindsight, and saying `false` would be the engine answering a
   * question it cannot reach. One who holds none is blind either way, because
   * no distance could have made a sense they do not have reach.
   */
  it('is unsettled where the distance cannot be measured and Blindsight might have reached', () => {
    const unplaced = (sense: Sense) =>
      fold(
        'seed',
        // Nobody is placed, so there is no distance for a range to be
        // measured against — the same hole a scene with one creature standing
        // outside it leaves.
        scene(SEER, 55, sense).filter((e) => e.type !== 'creature-placed'),
      );
    expect(canSee(unplaced('blindsight'), SEER, OTHER)).toBeNull();
    expect(canSomehowSee(unplaced('blindsight'), SEER, OTHER)).toBeNull();
    expect(canSee(unplaced('none'), SEER, OTHER)).toBe(false);

    // And the same answer about a place with no coordinates, which is the one
    // the two used to disagree about.
    expect(canSeePoint(unplaced('blindsight'), SEER, null)).toBeNull();
    expect(canSeePoint(unplaced('none'), SEER, null)).toBe(false);
  });

  /** And the sight of a place — Hypnotic Pattern's "who can see the pattern". */
  it('closes the question about a place', () => {
    const at = { x: 100, y: 130, z: 0 };
    expect(canSeePoint(fold('seed', scene(SEER, 55, 'none')), SEER, at)).toBe(false);
    expect(canSeePoint(fold('seed', scene(SEER, 55, 'blindsight')), SEER, at)).toBe(true);
    expect(
      canSeePoint(fold('seed', scene(SEER, 55, 'none', { blind: false })), SEER, at),
    ).toBeNull();
  });
});

// — a casting: "a creature you can see" ————————————————————————————————————

/**
 * SRD Blindness/Deafness: Range 120 feet, "one creature that you can see
 * within range". The target is well inside the spell and either side of the
 * sense, so the two bounds cannot be confused.
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

describe('a Blinded caster cannot target "a creature you can see"', () => {
  const cast = (log: readonly GameEvent[]) =>
    resolveSpell(
      fold('seed', log),
      SEER,
      { spellId: 'blindness-deafness', targets: [OTHER], slotLevel: 2, choice: 'blinded' },
      supply('blind'),
    );

  it('is refused rather than asked', () => {
    const out = cast(scene(SEER, 55, 'none', {}, CASTING));
    expect(isErr(out) && out.code).toBe('cannot_see_target');
  });

  it('is refused even where the table declared the line', () => {
    const out = cast(
      scene(SEER, 55, 'none', {}, [
        ...CASTING,
        { type: 'sight-declared', from: SEER, to: OTHER, seen: true },
      ]),
    );
    expect(isErr(out) && out.code).toBe('cannot_see_target');
  });

  it('lands where Blindsight reaches, and is refused beyond it', () => {
    const near = unwrap(cast(scene(SEER, 55, 'blindsight', {}, CASTING)), 'blindsight at 55');
    expect(near.outcomes[0]?.target).toBe(OTHER);
    const far = cast(scene(SEER, 65, 'blindsight', {}, CASTING));
    expect(isErr(far) && far.code).toBe('cannot_see_target');
  });
});

describe('the shortlist reads the condition the casting does', () => {
  const shortlist = (log: readonly GameEvent[]) =>
    eligibleTargets(fold('seed', log), SRD_CONTENT, SEER, 'blindness-deafness', 2);

  it('leaves the target off and says the caster cannot see them', () => {
    const out = shortlist(scene(SEER, 55, 'none', {}, CASTING));
    expect(out.eligible).toEqual([]);
    expect(out.needsContext).toEqual([]);
    expect(out.excluded.map((e) => e.target)).toEqual([OTHER]);
  });

  it('lists them again where Blindsight reaches', () => {
    expect(shortlist(scene(SEER, 55, 'blindsight', {}, CASTING)).eligible).toEqual([OTHER]);
  });
});

// — a teleport: "a space you can see" ——————————————————————————————————————

describe('a Blinded teleporter cannot pick a space it can see', () => {
  const hop = (log: readonly GameEvent[]) =>
    relocateCreature(fold('seed', log), SEER, {
      placement: { from: { creature: OTHER }, feet: 5, bearing: 180 },
      within: 500,
      requiresSight: true,
    });

  it('is refused rather than asked', () => {
    const out = hop(scene(SEER, 55, 'none'));
    expect(isErr(out) && out.code).toBe('cannot_see_destination');
  });

  it('goes where Blindsight reaches', () => {
    expect(unwrap(hop(scene(SEER, 55, 'blindsight')), 'blindsight hop').feet).toBeGreaterThan(0);
  });
});

// — an Opportunity Attack: "a creature that you can see leaves your reach" ——

describe('a Blinded reactor is provoked by nobody', () => {
  const MOVER = OTHER;
  const REACTOR = SEER;

  const walkAway = (sense: Sense, { blind = true }: { blind?: boolean } = {}) =>
    unwrap(
      resolveMove(
        fold(
          'seed',
          scene(REACTOR, 5, sense, { blind }, [
            {
              type: 'combat-started',
              combatants: [
                { id: MOVER, initiative: 20, speed: 30 },
                { id: REACTOR, initiative: 10, speed: 30 },
              ],
            },
          ]),
        ),
        MOVER,
        { placement: { from: { creature: REACTOR }, feet: 25, bearing: 90 }, forced: false },
        supply('walk'),
      ),
      'move',
    );

  const declared = (events: readonly GameEvent[]) =>
    events.some((e) => e.type === 'movement-declared');

  it('offers the swing to nobody, and asks nothing', () => {
    const out = walkAway('none');
    expect(declared(out.events)).toBe(false);
    expect(out.unverified.filter((u) => u.includes('can see'))).toEqual([]);
  });

  it('still offers it where Blindsight reaches the mover', () => {
    expect(declared(walkAway('blindsight').events)).toBe(true);
  });

  /** The contrast: the same reactor with working eyes is offered the swing. */
  it('offers it to the same creature unblinded', () => {
    expect(declared(walkAway('none', { blind: false }).events)).toBe(true);
  });
});

// — a Reaction feature: the reactor must see whose roll they answer ————————

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

describe('a Blinded reactor is offered no Reaction that needs sight', () => {
  const ROLLER = OTHER;
  const REACTOR = SEER;

  const offers = (sense: Sense, { blind = true }: { blind?: boolean } = {}) =>
    offersForDamage(
      fold(
        'seed',
        scene(REACTOR, 55, sense, { blind }).map((e) =>
          e.type === 'creature-added' && e.id === REACTOR
            ? { ...e, sheet: { ...e.sheet, reactions: [CUTTING] } }
            : e,
        ),
      ),
      { target: REACTOR, by: ROLLER, fromAttack: true, damageTypes: ['slashing'] },
    );

  it('withholds the offer and reports no unsettled question', () => {
    const out = offers('none');
    expect(out.offers).toEqual([]);
    expect(out.unverified).toEqual([]);
  });

  it('offers it where Blindsight reaches', () => {
    expect(offers('blindsight').offers.map((o) => o.feature)).toEqual([CUTTING.feature]);
  });
});

// — Dodge: "if you can see the attacker" ———————————————————————————————————
//
// Driven in `dodge.test.ts`, where the Dodge harness lives.

// — a ranged attack at close quarters: "an enemy who can see you" ——————————

describe('a Blinded enemy beside you does not hamper a ranged attack', () => {
  it('is excused by the condition as it is by a declared no', () => {
    expect(enemyWithinFiveFeet(fold('seed', scene(OTHER, 5, 'none')), SEER).near).toBe(false);
  });

  it('hampers again where the enemy’s Blindsight reaches', () => {
    expect(enemyWithinFiveFeet(fold('seed', scene(OTHER, 5, 'blindsight')), SEER).near).toBe(true);
  });

  it('hampers when the enemy’s eyes work', () => {
    expect(
      enemyWithinFiveFeet(fold('seed', scene(OTHER, 5, 'none', { blind: false })), SEER).near,
    ).toBe(true);
  });
});

// — Hide: "out of any enemy's line of sight" ———————————————————————————————

describe('a Blinded watcher is no obstacle to a Hide', () => {
  const hide = (sense: Sense) =>
    takeHide(fold('seed', scene(OTHER, 55, sense)), SEER, { obscured: true }, supply('hide'));

  it('lets the Hide through rather than refusing or asking', () => {
    expect(isErr(hide('none'))).toBe(false);
  });

  it('refuses where the watcher’s Blindsight reaches', () => {
    const out = hide('blindsight');
    expect(isErr(out) && out.code).toBe('seen');
  });
});
