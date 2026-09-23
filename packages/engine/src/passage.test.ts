import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import type { CreatureSize } from '@ie/srd';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import { sizeOf, type Point } from './positioning.js';
import { placeCreatureInScene, resolveMove } from './commands.js';
import { checkContent } from './content.js';
import type { CatalogueItem } from './catalogue.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * Walking through somebody else's space.
 *
 * SRD, "Moving around Other Creatures": "During your move, you can pass
 * through the space of an ally, a creature that has the Incapacitated
 * condition, a Tiny creature, or a creature that is two sizes larger or
 * smaller than you." `canPassThrough` has said so since positioning landed
 * and **nothing asked it**: `choosePoint` tested the destination alone, so
 * anybody walked through anybody as long as they did not stop there.
 *
 * What is wired here is the reader. A move that states its `route` is checked
 * space by space against the sentence above; a move that states none is
 * charged exactly as it always was, unless every shortest way there crosses
 * somebody, in which case the route is asked for rather than guessed at.
 *
 * And the trait that bends it, which is why the rule had to be wired first —
 * SRD Halfling Nimbleness: "You can move through the space of any creature
 * that is a size larger than you, but you can't stop in the same space." A
 * `passage` standing grant lowers the two sizes to one for its holder, and
 * the second half of the sentence is what `occupied` has always enforced.
 */

const id = (s: string) => asCharacterId(s);
const WALKER = id('walker');
const BLOCKER = id('blocker');

const sheet = (standing: CharacterSheet['standing'] = undefined): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 16, con: 12, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 60,
  spellcastingAbility: null,
  weaponProficiencies: ['simple', 'martial'],
  ...(standing === undefined ? {} : { standing }),
});

/** SRD Halfling Nimbleness, as the grant the catalogue writes. */
const NIMBLE: CharacterSheet['standing'] = [
  {
    feature: 'halfling:halfling-nimbleness',
    name: 'Halfling Nimbleness',
    reach: { kind: 'self' as const },
    grant: { kind: 'passage' as const, sizesLarger: 1 },
  },
];

const added = (
  who: string,
  side: string | null,
  standing?: CharacterSheet['standing'],
): GameEvent => ({
  type: 'creature-added',
  id: id(who),
  name: who,
  sheet: sheet(standing),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  ...(side === null ? {} : { side }),
});

const placed = (who: string, at: Point, size: CreatureSize): GameEvent => ({
  type: 'creature-placed',
  id: id(who),
  placement: { from: { point: at }, feet: 0, size },
});

/**
 * The walker at (100, 100) and somebody standing fifteen feet east of them.
 *
 * Fifteen rather than ten so that the blocker is outside the walker's own
 * reach at the start of the move: a creature that leaves a reach it was
 * inside provokes, and an Opportunity Attack holds the move open, which is a
 * different test's business.
 */
const scene = (
  moverSize: CreatureSize,
  blockerSize: CreatureSize,
  over: {
    readonly blockerSide?: string | null;
    readonly nimble?: boolean;
    readonly incapacitated?: boolean;
  } = {},
): readonly GameEvent[] => [
  added('walker', 'party', over.nimble === true ? NIMBLE : undefined),
  added('blocker', over.blockerSide === undefined ? 'goblins' : over.blockerSide),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  placed('walker', { x: 100, y: 100, z: 0 }, moverSize),
  placed('blocker', { x: 115, y: 100, z: 0 }, blockerSize),
  { type: 'combat-started', combatants: [{ id: WALKER, initiative: 20, speed: 60 }] },
  ...(over.incapacitated === true
    ? ([
        { type: 'condition-applied', id: BLOCKER, condition: 'incapacitated', source: 'a spell' },
      ] as const)
    : []),
];

const supply = (seed = 'passage') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** Thirty feet east, which on the lattice is six spaces ending at (130, 100). */
const EASTWARD: readonly Point[] = [105, 110, 115, 120, 125, 130].map((x) => ({
  x,
  y: 100,
  z: 0,
}));

const east = (feet: number, route?: readonly Point[]) => ({
  placement: { from: { point: { x: 100, y: 100, z: 0 } }, feet, bearing: 90 },
  ...(route === undefined ? {} : { route }),
});

const walk = (log: readonly GameEvent[], request: Parameters<typeof resolveMove>[2]) =>
  resolveMove(fold('seed', log), WALKER, request, supply());

/**
 * A walker with an Ogre on the one diagonal it could walk: ten feet across
 * and ten feet tall, so the space over its head is not a way round either.
 */
const hemmedIn = (blockerSide: string): readonly GameEvent[] => [
  added('walker', 'party'),
  added('blocker', blockerSide),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  placed('walker', { x: 100, y: 100, z: 0 }, 'medium'),
  placed('blocker', { x: 105, y: 105, z: 0 }, 'large'),
  { type: 'combat-started', combatants: [{ id: WALKER, initiative: 20, speed: 60 }] },
];

describe('a move through somebody else’s space', () => {
  /**
   * The base rule, on the size gap the book prints. The blocker stands at
   * (115, 100) and the stated route walks through it.
   */
  it('is refused where the two are the same size', () => {
    const out = walk(scene('medium', 'medium'), east(30, EASTWARD));
    expect(isErr(out) ? out.code : 'allowed').toBe('blocked_by_creature');
    expect(isErr(out) ? out.reason : '').toContain('blocker');
  });

  /** "or a creature that is two sizes larger or smaller than you." */
  it('is allowed through a creature two sizes larger', () => {
    const out = unwrap(walk(scene('medium', 'huge'), east(30, EASTWARD)), 'through the huge one');
    expect(out.feet).toBe(30);
  });

  /** "you can pass through the space of an ally" — the same size, same side. */
  it('is allowed through an ally of the same size', () => {
    const out = unwrap(
      walk(scene('medium', 'medium', { blockerSide: 'party' }), east(30, EASTWARD)),
      'through the ally',
    );
    expect(out.feet).toBe(30);
  });

  /** "a creature that has the Incapacitated condition", whatever its size. */
  it('is allowed through an Incapacitated creature of the same size', () => {
    const out = unwrap(
      walk(scene('medium', 'medium', { incapacitated: true }), east(30, EASTWARD)),
      'through the stunned one',
    );
    expect(out.feet).toBe(30);
  });

  /**
   * And a side nobody has declared is a fact that is missing rather than
   * wrong, so the move goes through and the fact is reported — the same
   * reading `provokedBy` takes of an undeclared side one function along.
   */
  it('goes through an undeclared side, and says that it did', () => {
    const out = unwrap(
      walk(scene('medium', 'medium', { blockerSide: null }), east(30, EASTWARD)),
      'through the stranger',
    );
    expect(out.feet).toBe(30);
    expect(out.unverified.join(' ')).toContain('whose side');
  });

  /**
   * A route the caller does not state is charged exactly as it always was:
   * the engine does not infer a line between the endpoints, and a shortest
   * way round this blocker exists.
   */
  it('is allowed when no route is stated', () => {
    const out = unwrap(walk(scene('medium', 'medium'), east(30)), 'no route stated');
    expect(out.feet).toBe(30);
    expect(out.cost).toBe(30);
  });

  /**
   * The one case the engine can settle without being told: a walk fifteen
   * feet along the diagonal has exactly one shortest route — every other way
   * round is a longer walk, which is two moves rather than one — and an Ogre
   * ten feet across and ten feet tall stands on all of it, over its head
   * included. So the move provably crossed somebody, and which space it was
   * is the table's to state: `route_required`, the same question terrain
   * asks, answered by the same field.
   */
  it('asks for the route when every shortest way there crosses somebody', () => {
    const hemmed = hemmedIn('goblins');
    const diagonal = {
      placement: { from: { point: { x: 100, y: 100, z: 0 } }, feet: 15, bearing: 45 },
    };
    const out = resolveMove(fold('seed', hemmed), WALKER, diagonal, supply());
    expect(isErr(out) ? out.code : 'allowed').toBe('route_required');

    // And the route it asked for is answered by the field it named — with the
    // refusal the crossing earns, which is why asking is not a loop for
    // everybody: an ally or a Gargantuan in the same square would walk on.
    const stated = resolveMove(
      fold('seed', hemmed),
      WALKER,
      {
        ...diagonal,
        route: [
          { x: 105, y: 105, z: 0 },
          { x: 110, y: 110, z: 0 },
          { x: 115, y: 115, z: 0 },
        ],
      },
      supply(),
    );
    expect(isErr(stated) ? stated.code : 'allowed').toBe('blocked_by_creature');
  });

  /**
   * And it asks only where the answer could change anything. The same walk
   * past the same Ogre on the same side crosses somebody whatever way it
   * goes — and every way it could go is a crossing the book allows, so there
   * is nothing for a stated route to settle and the question is not asked.
   * That is `chargeTerrain`'s rule about the Web in the far corner, applied
   * to creatures.
   */
  it('does not ask where everybody in the way is somebody it may walk through', () => {
    const out = resolveMove(
      fold('seed', hemmedIn('party')),
      WALKER,
      { placement: { from: { point: { x: 100, y: 100, z: 0 } }, feet: 15, bearing: 45 } },
      supply(),
    );
    expect(unwrap(out, 'past the ally').feet).toBe(15);
  });
});

describe('SRD Halfling Nimbleness bends it by one size', () => {
  /**
   * "You can move through the space of any creature that is a size larger
   * than you" — a Small creature through a Medium one, which the two-size
   * rule refuses to everybody else.
   */
  it('lets a Small holder through a Medium creature', () => {
    const refused = walk(scene('small', 'medium'), east(30, EASTWARD));
    expect(isErr(refused) ? refused.code : 'allowed').toBe('blocked_by_creature');

    const out = unwrap(
      walk(scene('small', 'medium', { nimble: true }), east(30, EASTWARD)),
      'the nimble halfling',
    );
    expect(out.feet).toBe(30);
  });

  /** "any creature that is a size larger than you" — and no smaller one. */
  it('does not let it through another Small creature', () => {
    const out = walk(scene('small', 'small', { nimble: true }), east(30, EASTWARD));
    expect(isErr(out) ? out.code : 'allowed').toBe('blocked_by_creature');
  });

  /**
   * "but you can't stop in the same space", which is the sentence
   * `occupied` has enforced since positioning landed: SRD's "You can't
   * willingly end a move in a space occupied by another creature."
   */
  it('still refuses a stop in the space it walked through', () => {
    const out = walk(scene('small', 'medium', { nimble: true }), east(15));
    expect(isErr(out) ? out.code : 'allowed').toBe('occupied');
  });

  /**
   * And a grant that bends nothing is refused where it is written, on
   * `carrying-capacity`'s own rule: a step of none is a sentence with no
   * effect, and an inert grant is what the content validator exists to catch.
   * Through an item, because that is the door a homebrew grant of this kind
   * arrives at and the one `ITEM_EFFECT_KINDS` had to admit it to.
   */
  it('refuses a passage grant that bends nothing', () => {
    const slippers = (sizesLarger: unknown) => ({
      id: 'slippers-of-the-gap',
      name: 'Slippers of the Gap',
      kind: 'wondrous',
      weightLb: 0,
      costCp: null,
      armor: null,
      weapon: null,
      contents: [],
      attunement: {},
      grants: [
        {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'passage', sizesLarger }],
          requires: [{ kind: 'while-worn' }],
        },
      ],
    });

    const codes = (item: unknown): readonly string[] =>
      checkContent({ items: [item as CatalogueItem] }).map((problem) => problem.code);

    expect(codes(slippers(0))).toContain('bad_passage_step');
    expect(codes(slippers(1))).toEqual([]);
  });

  /**
   * And the whole way through: the SRD catalogue's own Halfling, made by
   * `createCharacter`, placed at the size the species prints, walking past a
   * Medium enemy. Nothing in this test names the grant — it proves the
   * catalogue reaches the rule, which is the half a hand-written sheet
   * cannot.
   */
  it('reaches a Halfling the book made', () => {
    const halfling = (): CharacterChoices => ({
      name: 'Rosie',
      classId: 'fighter',
      level: 1,
      speciesId: 'halfling',
      backgroundId: 'sage',
      abilities: {
        method: 'standard-array',
        assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
      },
      abilityIncreases: { con: 2, int: 1 },
      classSkills: ['athletics', 'survival'],
      languages: ['Dwarvish', 'Orc'],
      alignment: 'Neutral',
      cantrips: [],
      spellbook: [],
      preparedSpells: [],
      classEquipment: 'A',
      backgroundEquipment: 'A',
      equipped: [],
      hitPoints: { method: 'fixed' },
      featureChoices: { 'fighter:weapon-mastery': [] },
      feats: {
        'sage:magic-initiate-wizard': {
          featId: 'magic-initiate',
          spellList: 'wizard',
          spellcastingAbility: 'int',
          cantrips: ['mage-hand', 'light'],
          levelOneSpell: 'find-familiar',
        },
        'fighter:fighting-style': { featId: 'archery' },
      },
      dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
    });

    const made = unwrap(createCharacter(SRD_CONTENT, halfling(), WALKER), 'the halfling');
    const before: readonly GameEvent[] = [
      ...(made as readonly GameEvent[]),
      // A side, because `createCharacter` declares none and an undeclared one
      // is the case the engine reports rather than rules on — which would
      // make this test pass whatever the trait said.
      { type: 'creature-side-declared', id: WALKER, side: 'party' },
      added('blocker', 'goblins'),
      { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
    ];
    const log: readonly GameEvent[] = [
      ...before,
      // Through the command, so the size is the one the species pinned onto
      // the creature rather than one this test chose for it.
      ...unwrap(
        placeCreatureInScene(fold('seed', before), WALKER, {
          from: { point: { x: 100, y: 100, z: 0 } },
          feet: 0,
        }),
        'placing the halfling',
      ),
      placed('blocker', { x: 115, y: 100, z: 0 }, 'medium'),
      { type: 'combat-started', combatants: [{ id: WALKER, initiative: 20, speed: 30 }] },
    ];

    // Non-vacuous in the one way it could be: a Halfling placed as anything
    // but Small would be two sizes from nobody and would walk past on the
    // glossary's own rule, proving nothing about the trait.
    expect(sizeOf(fold('seed', log).scene!, WALKER)).toBe('small');

    const out = unwrap(walk(log, east(25, EASTWARD.slice(0, 5))), 'the halfling walking past');
    expect(out.feet).toBe(25);
  });
});
