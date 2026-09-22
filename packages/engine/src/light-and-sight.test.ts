import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { fold, type GameEvent } from './events.js';
import { canSee, canSomehowSee, rollModesFor } from './standing.js';
import { lightAt, obscurementAt } from './positioning.js';
import { declareLight, declareObscurement, resolveSpell, takeHide } from './commands.js';
import { createRng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinition } from './spell-schema.js';
import type { SpellDefinition } from './spell-definitions.js';
import { checkContent } from './content.js';
import type { SpeciesDefinition } from './origins.js';

/**
 * Light, obscurement, and the one step they add to the sight question.
 *
 * `docs/design/light-and-sight.md` is the design and the owner ruled all five
 * of its decisions on 2026-09-21. The six sentences below are the ones that
 * note names as the tests to write first, and each is here in its own words:
 *
 * 1. nothing declared, and `canSee` answers exactly as it did before any of
 *    this existed — the **no default ambient** ruling, tested rather than
 *    asserted;
 * 2. a dwarf thirty feet from an orc in declared nonmagical darkness sees
 *    her, in a Darkness casting does not, with Devil's Sight does, and with a
 *    declared sight line does regardless;
 * 3. a Rogue in a Fog Cloud Hides with no `obscured: true` on the command;
 * 4. a patch hung on a casting is gone the read after that casting ends,
 *    both for a record the table wrote and for a Darkness the engine cast;
 * 5. a Disadvantage gated on sunlight bites only where its holder stands in
 *    sunlight;
 * 6. the two frozen fixtures, which are `persistence.test.ts`'s and
 *    `persistence-2.test.ts`'s and stay theirs — no frozen log holds a patch.
 */

const id = (s: string) => asCharacterId(s);
const DWARF = id('dwarf');
const ORC = id('orc');
const HUMAN = id('human');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 1,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  ...over,
});

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}, side?: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 20,
  diesAtZero: false,
  creatureType: 'Humanoid',
  ...(side === undefined ? {} : { side }),
});

/** Darkvision 60, as a species trait grants it. */
const DARKVISION_60 = {
  feature: 'a-species:darkvision',
  name: 'Darkvision',
  reach: { kind: 'self' },
  grant: { kind: 'sense', sense: 'darkvision', feet: 60 },
} as const;

/**
 * SRD Devil's Sight: "You can see normally in Darkness, both magical and
 * nonmagical, to a distance of 120 feet."
 */
const DEVILS_SIGHT = {
  feature: 'an-invocation:devils-sight',
  name: "Devil's Sight",
  reach: { kind: 'self' },
  grant: { kind: 'sees-through', through: 'darkness', feet: 120 },
} as const;

/** The dwarf, the orc thirty feet away, and nobody has said anything else. */
const TABLE: readonly GameEvent[] = [
  added(DWARF, { standing: [DARKVISION_60] }),
  added(ORC),
  added(HUMAN),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the well', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: DWARF, placement: { from: { landmark: 'the well' }, feet: 0 } },
  { type: 'creature-placed', id: ORC, placement: { from: { creature: DWARF }, feet: 30, bearing: 90 } },
  { type: 'creature-placed', id: HUMAN, placement: { from: { creature: DWARF }, feet: 5, bearing: 180 } },
];

const darknessOver = (
  who: CharacterId,
  patch: string,
  extra: { magical?: { spellLevel: number }; source?: string } = {},
): GameEvent => ({
  type: 'light-declared',
  patch,
  region: { origin: { creature: who }, shape: { kind: 'sphere', radius: 0 } },
  level: 'darkness',
  ...extra,
});

// ─── 1. nothing declared ────────────────────────────────────────────────────

describe('nothing declared', () => {
  /**
   * The **no default ambient** ruling, as a test rather than a sentence: an
   * undeclared scene is undeclared, not bright, so every answer here is the
   * one this engine gave before light existed at all.
   */
  it('answers the sight question exactly as it did before light existed', () => {
    const state = fold('light', TABLE, SRD_CONTENT);

    // The sense reaches, and nobody has declared anything against it.
    expect(canSee(state, DWARF, ORC)).toBe(true);
    // No sense at all, and nobody has said: homework, not a no.
    expect(canSee(state, HUMAN, ORC)).toBeNull();
    // A creature sees itself, ahead of everything.
    expect(canSee(state, DWARF, DWARF)).toBe(true);
    // Invisible's shorter list: Darkvision never answered it and still does not.
    expect(canSomehowSee(state, DWARF, ORC)).toBeNull();
  });

  it('reports no light and no obscurement over any space', () => {
    const state = fold('light', TABLE, SRD_CONTENT);
    const here = { x: 130, y: 100, z: 0 };

    expect(lightAt(state, here).level).toBeNull();
    expect(obscurementAt(state, here).degree).toBeNull();
  });

  /** An ambient the table did state reaches every space of the room. */
  it('reads the ambient the scene was set with, where one was stated', () => {
    const state = fold(
      'light',
      [
        { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 }, light: 'dim' },
      ],
      SRD_CONTENT,
    );

    expect(lightAt(state, { x: 200, y: 200, z: 0 }).level).toBe('dim');
    // The glossary's own mapping: Dim Light is Lightly Obscured.
    expect(obscurementAt(state, { x: 200, y: 200, z: 0 }).degree).toBe('lightly');
  });
});

// ─── 2. the dwarf and the orc ───────────────────────────────────────────────

describe('a dwarf thirty feet from an orc', () => {
  const seeing = (events: readonly GameEvent[], looker: CharacterId = DWARF): boolean | null =>
    canSee(fold('light', [...TABLE, ...events], SRD_CONTENT), looker, ORC);

  it('sees her in declared nonmagical darkness, because Darkvision makes it dim', () => {
    expect(seeing([darknessOver(ORC, 'the unlit hall')])).toBe(true);
  });

  it('does not see her in a Darkness casting, which defeats Darkvision', () => {
    expect(seeing([darknessOver(ORC, 'Darkness', { magical: { spellLevel: 2 } })])).toBe(false);
  });

  /**
   * **Devil's Sight lifts the impediment; the Darkvision under it answers.**
   * SRD's word is "normally", so what the invocation buys is the *removal* of
   * the sentence that stops Darkvision working — which is why the tiefling
   * below carries both, as every SRD tiefling does, and why the dwarf beside
   * her with Darkvision alone is still blind in the same square.
   */
  it("sees her in that same magical darkness with Devil's Sight", () => {
    const state = fold(
      'light',
      [
        added(id('tiefling'), { standing: [DEVILS_SIGHT, DARKVISION_60] }),
        ...TABLE,
        {
          type: 'creature-placed',
          id: id('tiefling'),
          placement: { from: { creature: DWARF }, feet: 5, bearing: 270 },
        },
        darknessOver(ORC, 'Darkness', { magical: { spellLevel: 2 } }),
      ],
      SRD_CONTENT,
    );

    expect(canSee(state, id('tiefling'), ORC)).toBe(true);
    // The contrast, in the same square: the dwarf has the same Darkvision and
    // not the invocation, and the magical darkness still stops her.
    expect(canSee(state, DWARF, ORC)).toBe(false);
  });

  /**
   * And the impediment is all it removes. A creature with the invocation and
   * no sight-sense at all is back where the question started — `null`, which
   * is "ask", exactly as it would be in a lit room nobody has described.
   */
  it("gives a creature with nothing but Devil's Sight the question back", () => {
    const state = fold(
      'light',
      [
        added(id('imp'), { standing: [DEVILS_SIGHT] }),
        ...TABLE,
        {
          type: 'creature-placed',
          id: id('imp'),
          placement: { from: { creature: DWARF }, feet: 5, bearing: 270 },
        },
        darknessOver(ORC, 'Darkness', { magical: { spellLevel: 2 } }),
      ],
      SRD_CONTENT,
    );

    expect(canSee(state, id('imp'), ORC)).toBeNull();
  });

  it('sees her regardless once the table declares the sight line', () => {
    expect(
      seeing([
        darknessOver(ORC, 'Darkness', { magical: { spellLevel: 2 } }),
        { type: 'sight-declared', from: DWARF, to: ORC, seen: true },
      ]),
    ).toBe(true);
  });

  /** And the other way about: the declaration is still what outranks a sense. */
  it('is refused the sight the table declared away, lit or not', () => {
    expect(seeing([{ type: 'sight-declared', from: DWARF, to: ORC, seen: false }])).toBe(false);
  });

  it('leaves a creature with no Darkvision blind in ordinary darkness', () => {
    expect(seeing([darknessOver(ORC, 'the unlit hall')], HUMAN)).toBe(false);
  });

  /**
   * The SRD's sentence is about the **target's** space — "while trying to see
   * something in that area" — so a looker standing in the dark sees a lit
   * target perfectly.
   */
  it('reads the target’s space and never the looker’s', () => {
    expect(seeing([darknessOver(DWARF, 'the alcove', { magical: { spellLevel: 2 } })])).toBe(true);
  });
});

// ─── 3. a Rogue in a Fog Cloud ──────────────────────────────────────────────

describe('Hide', () => {
  const ROGUE = id('rogue');
  const GOBLIN = id('goblin');

  const fight: readonly GameEvent[] = [
    added(ROGUE, { skills: { stealth: 'proficient' } }, 'party'),
    added(GOBLIN, {}, 'goblins'),
    { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
    { type: 'landmark-added', name: 'the yard', at: { x: 100, y: 100, z: 0 } },
    { type: 'creature-placed', id: ROGUE, placement: { from: { landmark: 'the yard' }, feet: 0 } },
    {
      type: 'creature-placed',
      id: GOBLIN,
      placement: { from: { creature: ROGUE }, feet: 20, bearing: 0 },
    },
  ];

  const supply = () => ({
    issuer: createRollIssuer('fog'),
    rng: createRng('fog'),
    content: SRD_CONTENT,
  });

  it('is refused with nothing declared, as it always was', () => {
    const state = fold('light', fight, SRD_CONTENT);
    const outcome = takeHide(state, ROGUE, {}, supply());

    expect(isErr(outcome)).toBe(true);
  });

  /**
   * A Fog Cloud is obscurement that is not a light level, which is why
   * `obscurement` is a record of its own beside `light`. With the patch on the
   * lattice the command no longer needs the table to say `obscured: true` —
   * and the log carries the fact, which the flag never did.
   */
  it('is allowed by a declared Fog Cloud with no obscured flag on the command', () => {
    const state = fold(
      'light',
      [
        ...fight,
        {
          type: 'obscurement-declared',
          patch: 'Fog Cloud',
          region: { origin: { creature: ROGUE }, shape: { kind: 'sphere', radius: 20 } },
          degree: 'heavily',
        },
      ],
      SRD_CONTENT,
    );

    // The goblin cannot see through it either, which is the other half of the
    // same patch and what "out of any enemy's line of sight" asks.
    expect(canSee(state, GOBLIN, ROGUE)).toBe(false);
    expect(isErr(takeHide(state, ROGUE, {}, supply()))).toBe(false);
  });

  /** Lightly Obscured is not enough: the book asks for Heavily. */
  it('is still refused where the fog is only light', () => {
    const state = fold(
      'light',
      [
        ...fight,
        {
          type: 'obscurement-declared',
          patch: 'the haze',
          region: { origin: { creature: ROGUE }, shape: { kind: 'sphere', radius: 20 } },
          degree: 'lightly',
        },
      ],
      SRD_CONTENT,
    );

    expect(isErr(takeHide(state, ROGUE, {}, supply()))).toBe(true);
  });
});

// ─── 4. a patch lapses with its casting ─────────────────────────────────────

describe('a patch hung on a casting', () => {
  /**
   * Derived at read time, exactly as `livePatches` derives a Web's: there is
   * no window in which the casting is over and the room is still dark.
   */
  const CASTING = 'casting-of-the-gloom';

  const running: readonly GameEvent[] = [
    ...TABLE,
    {
      type: 'spell-ongoing',
      casting: {
        castingId: CASTING,
        caster: DWARF,
        spellId: 'homebrew-gloom',
        spell: 'Gloom',
        level: 2,
        version: 3,
        numbers: { saveDc: 13, attackModifier: 5, spellcastingModifier: 3, casterLevel: 5 },
        on: [],
      },
    },
    darknessOver(ORC, `Gloom (${CASTING})`, { magical: { spellLevel: 2 }, source: CASTING }),
  ];

  it('darkens the orc’s space while the casting runs', () => {
    const state = fold('light', running, SRD_CONTENT);

    expect(lightAt(state, { x: 130, y: 100, z: 0 }).level).toBe('darkness');
    expect(canSee(state, DWARF, ORC)).toBe(false);
  });

  it('is gone the read after the casting leaves state.ongoing', () => {
    const state = fold(
      'light',
      [...running, { type: 'spell-ended', castingId: CASTING, on: null, reason: 'dispelled' }],
      SRD_CONTENT,
    );

    expect(lightAt(state, { x: 130, y: 100, z: 0 }).level).toBeNull();
    // And the whole of what that costs the sight question: the dwarf sees her
    // again the instant the Concentration goes, through no machinery at all.
    expect(canSee(state, DWARF, ORC)).toBe(true);
  });
});

// ─── 4b. the casting that lays its own patch ────────────────────────────────

describe('a Darkness the engine casts', () => {
  const WIZARD = id('wizard');

  const armed: readonly GameEvent[] = [
    added(WIZARD, { spellcastingAbility: 'int' }),
    added(ORC),
    {
      type: 'resource-pool-declared',
      id: WIZARD,
      pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 3, recovers: 'long-rest' },
    },
    {
      type: 'spellcasting-declared',
      id: WIZARD,
      spellcasting: declaredCasting({ ability: 'int', prepared: ['darkness'] }),
    },
    { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
    { type: 'landmark-added', name: 'the well', at: { x: 100, y: 100, z: 0 } },
    { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the well' }, feet: 0 } },
    {
      type: 'creature-placed',
      id: ORC,
      placement: { from: { creature: WIZARD }, feet: 30, bearing: 90 },
    },
  ];

  const supply = () => ({
    issuer: createRollIssuer('dark'),
    rng: createRng('dark'),
    content: SRD_CONTENT,
  });

  const cast = (): readonly GameEvent[] => [
    ...armed,
    ...unwrap(
      resolveSpell(
        fold('light', armed, SRD_CONTENT),
        WIZARD,
        { spellId: 'darkness', targets: [], at: { x: 130, y: 100, z: 0 }, slotLevel: 2 },
        supply(),
      ),
      'darkness',
    ).events,
  ];

  /**
   * The casting pins the region it resolved, exactly as an area casting pins
   * difficult ground — so a replay darkens the square that was darkened at
   * the table however the catalogue is corrected afterwards.
   */
  it('pins the Sphere it resolved as a patch of magical darkness', () => {
    const state = fold('light', cast(), SRD_CONTENT);
    const declared = cast().filter((event) => event.type === 'light-declared');

    expect(declared).toHaveLength(1);
    expect(lightAt(state, { x: 130, y: 100, z: 0 })).toMatchObject({
      level: 'darkness',
      magical: true,
    });
    // Fifteen feet of radius: the far edge is dark and a space past it is not.
    expect(lightAt(state, { x: 145, y: 100, z: 0 }).level).toBe('darkness');
    expect(lightAt(state, { x: 165, y: 100, z: 0 }).level).toBeNull();
  });

  it('blinds a Darkvision the table has said nothing against', () => {
    const state = fold(
      'light',
      [...cast(), { type: 'creature-added', id: DWARF, name: 'dwarf', sheet: sheet({ standing: [DARKVISION_60] }), maxHp: 20, diesAtZero: false, creatureType: 'Humanoid' },
        { type: 'creature-placed', id: DWARF, placement: { from: { landmark: 'the well' }, feet: 5, bearing: 180 } }],
      SRD_CONTENT,
    );

    expect(canSee(state, DWARF, ORC)).toBe(false);
  });

  it('is gone the read after the Concentration breaks', () => {
    const running = cast();
    const casting = running.find((event) => event.type === 'spell-ongoing');
    expect(casting?.type).toBe('spell-ongoing');
    const castingId = casting?.type === 'spell-ongoing' ? casting.casting.castingId : '';

    const state = fold(
      'light',
      [...running, { type: 'concentration-ended', id: WIZARD, castingId, reason: 'voluntary' }],
      SRD_CONTENT,
    );

    expect(state.ongoing[castingId]).toBeUndefined();
    expect(lightAt(state, { x: 130, y: 100, z: 0 }).level).toBeNull();
  });
});

// ─── 4c. the three spells, each laying what it prints ───────────────────────

/**
 * Daylight, Fog Cloud and the sentence the two of them share with Darkness.
 *
 * Driven through `resolveSpell` rather than asserted off the definitions,
 * because the three things this half of P3-S added are all things the
 * *casting* does and a definition cannot: the second, wider patch of Dim
 * Light; the radius a higher slot buys; and the dispel two overlapping areas
 * of opposite light owe each other.
 */
describe('a casting lays what its spell prints', () => {
  const CASTER = id('caster');
  const BYSTANDER = id('bystander');

  /**
   * Two casters, and the second one is two hundred and sixty feet away on
   * purpose: the only way two of these areas can fail to overlap is for the
   * casters to be nowhere near each other, since Daylight alone reaches sixty
   * feet of range and a hundred and twenty of radius.
   */
  const room = (prepared: readonly string[], slots: readonly number[]): readonly GameEvent[] => [
    added(CASTER, { spellcastingAbility: 'int' }),
    added(BYSTANDER, { spellcastingAbility: 'int' }),
    ...[CASTER, BYSTANDER].flatMap((who) =>
      slots.map(
        (level): GameEvent => ({
          type: 'resource-pool-declared',
          id: who,
          pool: {
            key: spellSlotKey(level),
            label: `level ${level} spell slot`,
            max: 3,
            recovers: 'long-rest',
          },
        }),
      ),
    ),
    ...[CASTER, BYSTANDER].map(
      (who): GameEvent => ({
        type: 'spellcasting-declared',
        id: who,
        spellcasting: declaredCasting({ ability: 'int', prepared: [...prepared] }),
      }),
    ),
    { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
    { type: 'landmark-added', name: 'the gate', at: { x: 300, y: 300, z: 0 } },
    { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'the gate' }, feet: 0 } },
    {
      type: 'creature-placed',
      id: BYSTANDER,
      placement: { from: { creature: CASTER }, feet: 260, bearing: 90 },
    },
  ];

  const supply = (seed: string) => ({
    issuer: createRollIssuer(seed),
    rng: createRng(seed),
    content: SRD_CONTENT,
  });

  const cast = (
    log: readonly GameEvent[],
    spellId: string,
    at: { x: number; y: number; z: number },
    slotLevel: number,
    by: CharacterId = CASTER,
  ): readonly GameEvent[] => [
    ...log,
    ...unwrap(
      resolveSpell(
        fold('light', log, SRD_CONTENT),
        by,
        { spellId, targets: [], at, slotLevel },
        supply(`${spellId}:${by}`),
      ),
      spellId,
    ).events,
  ];

  /**
   * SRD Daylight: "The sunlight's area is Bright Light and sheds Dim Light for
   * an additional 60 feet." Two patches on one origin, and the bright core
   * wins where they overlap because `lightAt` takes the strongest.
   */
  it('lays Daylight’s bright core and the dim ring beyond it', () => {
    const log = cast(room(['daylight'], [3]), 'daylight', { x: 340, y: 300, z: 0 }, 3);
    const state = fold('light', log, SRD_CONTENT);

    expect(log.filter((event) => event.type === 'light-declared')).toHaveLength(2);
    // Sixty feet of bright, and the sun's own flag on it.
    expect(lightAt(state, { x: 340, y: 300, z: 0 })).toMatchObject({
      level: 'bright',
      sunlight: true,
    });
    expect(lightAt(state, { x: 395, y: 300, z: 0 }).level).toBe('bright');
    // Sixty more of dim, which is not sunlight and says so.
    expect(lightAt(state, { x: 440, y: 300, z: 0 })).toMatchObject({
      level: 'dim',
      sunlight: false,
    });
    // And nothing at all past the ring: no default ambient, out here either.
    expect(lightAt(state, { x: 480, y: 300, z: 0 }).level).toBeNull();
  });

  /**
   * SRD Fog Cloud: "The fog's radius increases by 20 feet for each spell slot
   * level above 1." Expressible on the patch and not on the area, because the
   * patch is worked out at the casting and pinned.
   */
  it('grows Fog Cloud’s bank by the slot that paid for it', () => {
    const one = fold(
      'light',
      cast(room(['fog-cloud'], [1, 3]), 'fog-cloud', { x: 340, y: 300, z: 0 }, 1),
      SRD_CONTENT,
    );
    const three = fold(
      'light',
      cast(room(['fog-cloud'], [1, 3]), 'fog-cloud', { x: 340, y: 300, z: 0 }, 3),
      SRD_CONTENT,
    );

    const edge = { x: 390, y: 300, z: 0 };
    expect(obscurementAt(one, { x: 340, y: 300, z: 0 }).degree).toBe('heavily');
    // Fifty feet out: outside the level 1 Sphere, inside the level 3 one.
    expect(obscurementAt(one, edge).degree).toBeNull();
    expect(obscurementAt(three, edge).degree).toBe('heavily');
    // And the fog says nothing about the light, which is why it is a record
    // of its own: a bank of fog at noon is still bright and still blinding.
    expect(obscurementAt(three, edge).light.level).toBeNull();
  });

  /**
   * SRD Darkness: "If any of this spell's area overlaps with an area of Bright
   * Light or Dim Light created by a spell of level 2 or lower, that other
   * spell is dispelled." SRD Daylight prints the mirror of it at level 3.
   */
  describe('the mutual dispel', () => {
    const lit = () => cast(room(['daylight', 'darkness'], [2, 3]), 'daylight', { x: 340, y: 300, z: 0 }, 3);

    const castingOf = (log: readonly GameEvent[], spellId: string): string => {
      const record = log.find(
        (event) => event.type === 'spell-ongoing' && event.casting.spellId === spellId,
      );
      return record?.type === 'spell-ongoing' ? record.casting.castingId : '';
    };

    /** Daylight is level 3, and Darkness's threshold is 2. It survives. */
    it('leaves a light the incoming darkness does not out-rank', () => {
      const log = cast(lit(), 'darkness', { x: 350, y: 300, z: 0 }, 2);
      const state = fold('light', log, SRD_CONTENT);

      expect(log.filter((event) => event.type === 'spell-ended')).toEqual([]);
      expect(state.ongoing[castingOf(log, 'daylight')]).toBeDefined();
      // **And the sunlight wins the square, which is the SRD's own sentence
      // read exactly as far as it goes.** Darkness says "*nonmagical* light
      // can't illuminate it", so magical light can — and the book's way of
      // settling which magical light governs is the dispel, which this
      // Darkness lost by being level 2. A level 2 Darkness cast into a
      // Daylight therefore does nothing at all, which is what the pair of
      // printed thresholds says.
      expect(lightAt(state, { x: 350, y: 300, z: 0 })).toMatchObject({
        level: 'bright',
        magical: true,
      });
    });

    /** And the other way about: Daylight at 3 puts out a Darkness at 2. */
    it('puts out a darkness the incoming light does out-rank', () => {
      const dark = cast(room(['daylight', 'darkness'], [2, 3]), 'darkness', { x: 340, y: 300, z: 0 }, 2);
      const casting = castingOf(dark, 'darkness');
      expect(fold('light', dark, SRD_CONTENT).ongoing[casting]).toBeDefined();

      const log = cast(dark, 'daylight', { x: 350, y: 300, z: 0 }, 3);
      const state = fold('light', log, SRD_CONTENT);

      expect(
        log.filter((event) => event.type === 'spell-ended').map((event) =>
          event.type === 'spell-ended' ? event.castingId : '',
        ),
      ).toEqual([casting]);
      expect(state.ongoing[casting]).toBeUndefined();
      expect(lightAt(state, { x: 340, y: 300, z: 0 }).level).toBe('bright');
    });

    /**
     * Two areas that do not overlap argue about nothing — and this is the one
     * case where the scan actually runs and finds nothing, rather than being
     * skipped because there was no candidate to look for.
     */
    it('leaves a darkness the light does not reach', () => {
      const dark = cast(
        room(['daylight', 'darkness'], [2, 3]),
        'darkness',
        { x: 300, y: 300, z: 0 },
        2,
      );
      const log = cast(dark, 'daylight', { x: 560, y: 300, z: 0 }, 3, BYSTANDER);
      const state = fold('light', log, SRD_CONTENT);

      expect(log.filter((event) => event.type === 'spell-ended')).toEqual([]);
      expect(state.ongoing[castingOf(dark, 'darkness')]).toBeDefined();
      expect(lightAt(state, { x: 300, y: 300, z: 0 }).level).toBe('darkness');
      expect(lightAt(state, { x: 560, y: 300, z: 0 }).level).toBe('bright');
    });
  });
});

// ─── 5. sunlight ────────────────────────────────────────────────────────────

describe('a Disadvantage gated on sunlight', () => {
  /**
   * SRD Sunlight Sensitivity, on the Kobold, the Specter, the Wight and the
   * Wraith in one sentence: "While in sunlight, the kobold has Disadvantage on
   * ability checks and attack rolls." A `StandingRequirement` reading
   * `lightAt` at the holder's own space, which is what that sentence says.
   *
   * Sunlight is Bright Light with a flag rather than a fourth level — the
   * owner's fourth ruling — so a torch is not the sun and the Disadvantage
   * does not bite under one.
   */
  const KOBOLD = id('kobold');
  const SENSITIVE = {
    feature: 'a-monster:sunlight-sensitivity',
    name: 'Sunlight Sensitivity',
    reach: { kind: 'self' },
    grant: {
      kind: 'roll-mode',
      modifier: { mode: 'disadvantage', selector: { roll: 'attack', relation: 'roller' } },
    },
    requires: [{ kind: 'in-sunlight' }],
  } as const;

  const table = (patch: readonly GameEvent[]): GameEvent[] => [
    added(KOBOLD, { standing: [SENSITIVE] }),
    added(ORC),
    { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
    { type: 'landmark-added', name: 'the ridge', at: { x: 100, y: 100, z: 0 } },
    { type: 'creature-placed', id: KOBOLD, placement: { from: { landmark: 'the ridge' }, feet: 0 } },
    {
      type: 'creature-placed',
      id: ORC,
      placement: { from: { creature: KOBOLD }, feet: 30, bearing: 90 },
    },
    ...patch,
  ];

  const modes = (patch: readonly GameEvent[]): readonly string[] =>
    rollModesFor(fold('light', table(patch), SRD_CONTENT), {
      roller: KOBOLD,
      against: ORC,
      family: 'attack',
    }).modes.map((m) => m.source);

  it('does not bite where nobody has said what the light is', () => {
    expect(modes([])).toEqual([]);
  });

  it('does not bite under a torch, because bright is not sunlight', () => {
    expect(
      modes([
        {
          type: 'light-declared',
          patch: 'the torch',
          region: { origin: { creature: KOBOLD }, shape: { kind: 'sphere', radius: 20 } },
          level: 'bright',
        },
      ]),
    ).toEqual([]);
  });

  it('bites where its holder stands in sunlight', () => {
    expect(
      modes([
        {
          type: 'light-declared',
          patch: 'the open ridge',
          region: { origin: { creature: KOBOLD }, shape: { kind: 'sphere', radius: 20 } },
          level: 'bright',
          sunlight: true,
        },
      ]),
    ).toEqual(['Sunlight Sensitivity']);
  });

  it('does not bite where only the other creature is in the sun', () => {
    expect(
      modes([
        {
          type: 'light-declared',
          patch: 'the shaft of light',
          region: { origin: { creature: ORC }, shape: { kind: 'sphere', radius: 0 } },
          level: 'bright',
          sunlight: true,
        },
      ]),
    ).toEqual([]);
  });
});

// ─── the commands ───────────────────────────────────────────────────────────

describe('the two declarations', () => {
  it('refuse a patch hung on a casting nobody is running', () => {
    const state = fold('light', TABLE, SRD_CONTENT);
    const outcome = declareLight(state, 'Darkness', {
      region: { origin: { creature: ORC }, shape: { kind: 'sphere', radius: 15 } },
      level: 'darkness',
      source: 'casting-9',
    });

    expect(isErr(outcome)).toBe(true);
  });

  it('write the patch the fold reads back', () => {
    const state = fold('light', TABLE, SRD_CONTENT);
    const events = unwrap(
      declareObscurement(state, 'the fog', {
        region: { origin: { creature: ORC }, shape: { kind: 'sphere', radius: 20 } },
        degree: 'heavily',
      }),
      'declare',
    );

    const after = fold('light', [...TABLE, ...events], SRD_CONTENT);
    expect(obscurementAt(after, { x: 130, y: 100, z: 0 }).degree).toBe('heavily');
  });

  /**
   * The vocabulary is closed at both doors, and each refusal says which word
   * was wrong — the same rule `bad_sense` keeps for the glossary's four.
   */
  it('refuse a word the glossary does not print', () => {
    const state = fold('light', TABLE, SRD_CONTENT);
    const region = { origin: { creature: ORC }, shape: { kind: 'sphere', radius: 0 } } as const;

    const level = declareLight(state, 'the gloom', {
      region,
      level: 'gloomy' as 'dim',
    });
    expect(isErr(level) && level.code).toBe('bad_light_level');

    const degree = declareObscurement(state, 'the murk', {
      region,
      degree: 'somewhat' as 'lightly',
    });
    expect(isErr(degree) && degree.code).toBe('bad_obscurement');
  });

  /** Magical light carries a whole number of spell levels, or it carries nothing. */
  it('refuse magical light whose spell level is not a number', () => {
    const state = fold('light', TABLE, SRD_CONTENT);
    const outcome = declareLight(state, 'the glow', {
      region: { origin: { creature: ORC }, shape: { kind: 'sphere', radius: 0 } },
      level: 'bright',
      magical: { spellLevel: 2.5 },
    });

    expect(isErr(outcome) && outcome.code).toBe('bad_spell_level');
  });

  /**
   * Sunlight is Bright Light with a flag, which means a patch that is not
   * bright cannot carry it — a kept contradiction would hand Sunlight
   * Sensitivity a bite in a cellar.
   */
  it('refuse sunlight that is not bright', () => {
    const state = fold('light', TABLE, SRD_CONTENT);
    const outcome = declareLight(state, 'the cellar', {
      region: { origin: { creature: ORC }, shape: { kind: 'sphere', radius: 0 } },
      level: 'dim',
      sunlight: true,
    });

    expect(isErr(outcome) && outcome.code).toBe('bad_sunlight');
  });

  it('refuse a patch with no name, as the ground declaration does', () => {
    const state = fold('light', TABLE, SRD_CONTENT);
    expect(
      isErr(
        declareLight(state, '  ', {
          region: { origin: { creature: ORC }, shape: { kind: 'sphere', radius: 15 } },
          level: 'darkness',
        }),
      ),
    ).toBe(true);
  });
});

// ─── the other door the same rules come through ─────────────────────────────

/**
 * The validator's half, which is the half homebrew hits.
 *
 * `declareLightPatch`'s refusals above are the table's door; these are a
 * *definition's*, and the rule is kept at both for the reason
 * `spell-schema.ts` already states of the terrain rate — a definition the
 * validator let through would throw in the reducer rather than be refused at
 * authoring, which is a corrupt log instead of a rejected book.
 */
describe('a definition that sheds or obscures', () => {
  const base: SpellDefinition = {
    id: 'homebrew-gloom',
    name: 'Homebrew Gloom',
    level: 2,
    school: 'evocation',
    castingTime: 'action',
    concentration: true,
    range: { kind: 'ranged', feet: 60 },
    targets: { count: 0 },
    area: { kind: 'sphere', radius: 15, origin: 'point' },
    effects: [],
    durationSeconds: 600,
    // The patch *is* what this spell resolves, and the line says what is left
    // — which is what keeps a definition with an empty effect list from being
    // a silent one.
    unmodelled: ['the smell of the gloom is the DM’s'],
  };
  const codes = (definition: SpellDefinition): readonly string[] =>
    checkSpellDefinition(definition).map((problem) => problem.code);

  it('is accepted whole where every field agrees', () => {
    expect(codes({ ...base, areaLight: { level: 'darkness' } })).toEqual([]);
    expect(
      codes({ ...base, areaLight: { level: 'bright', dimBeyond: 20, sunlight: true } }),
    ).toEqual([]);
    expect(
      codes({ ...base, areaObscurement: { degree: 'heavily', radiusPerSlotLevelAbove: 20 } }),
    ).toEqual([]);
  });

  /** Light lies over an area; a spell with no volume lights no part of a room. */
  it('refuses light and fog on a spell with no area', () => {
    const { area, ...rest } = base;
    expect(area).toBeDefined();
    const areaLess: SpellDefinition = rest;
    expect(codes({ ...areaLess, areaLight: { level: 'dim' } })).toContain('light_without_area');
    expect(codes({ ...areaLess, areaObscurement: { degree: 'heavily' } })).toContain(
      'obscurement_without_area',
    );
  });

  /** The glossary's three words and its two, closed at this door as at the other. */
  it('refuses a word the glossary does not print', () => {
    expect(codes({ ...base, areaLight: { level: 'gloomy' as 'dim' } })).toContain(
      'bad_light_level',
    );
    expect(
      codes({ ...base, areaObscurement: { degree: 'somewhat' as 'lightly' } }),
    ).toContain('bad_obscurement');
  });

  it('refuses sunlight that is not bright', () => {
    expect(codes({ ...base, areaLight: { level: 'dim', sunlight: true } })).toContain(
      'bad_sunlight',
    );
  });

  /**
   * Light spreading past the area is measured from the area's edge, and only
   * a Sphere has an edge that is one number — so a ring around a Cone is a
   * field that would silently lay nothing.
   */
  it('refuses a dim ring it could not measure, and one of no size', () => {
    expect(codes({ ...base, areaLight: { level: 'bright', dimBeyond: 0 } })).toContain(
      'bad_dim_beyond',
    );
    expect(
      codes({
        ...base,
        area: { kind: 'cone', length: 30, origin: 'self' },
        areaLight: { level: 'bright', dimBeyond: 20 },
      }),
    ).toContain('dim_beyond_without_a_radius');
  });

  it('refuses fog that grows by nothing, and fog that grows with no radius', () => {
    expect(
      codes({ ...base, areaObscurement: { degree: 'heavily', radiusPerSlotLevelAbove: 0 } }),
    ).toContain('bad_obscurement_growth');
    expect(
      codes({
        ...base,
        area: { kind: 'cube', size: 20, origin: 'point' },
        areaObscurement: { degree: 'heavily', radiusPerSlotLevelAbove: 20 },
      }),
    ).toContain('growth_without_a_radius');
  });

  /**
   * And the one that is a *duplication* rather than a contradiction: a level
   * implies its own degree in `obscurementAt`, so a definition that writes
   * both has two records of one fact and one of them will go stale.
   */
  it('refuses an obscurement the light already states', () => {
    expect(
      codes({
        ...base,
        areaLight: { level: 'darkness' },
        areaObscurement: { degree: 'heavily' },
      }),
    ).toContain('obscurement_the_light_already_says');
    // Bright says nothing about obscurement, so fog beside it is Web's own
    // sentence and not a second spelling of anything.
    expect(
      codes({
        ...base,
        areaLight: { level: 'bright' },
        areaObscurement: { degree: 'lightly' },
      }),
    ).toEqual([]);
  });
});

/**
 * And the grant that is not a sense, held to the same shape at both doors.
 */
describe('a sees-through grant', () => {
  /** A species carrying one feature, so the validator is asked about a grant. */
  const speciesGranting = (grant: unknown): SpeciesDefinition =>
    ({
      id: 'nightfolk',
      name: 'Nightfolk',
      creatureType: 'Humanoid',
      sizes: ['Medium'],
      speed: 30,
      features: [
        {
          id: 'nightfolk:devils-sight',
          name: "Devil's Sight",
          level: 1,
          automation: 'engine',
          note: 'Applied whole: the range reaches the sight question.',
          grants: { kind: 'standing', effects: [grant] },
        },
      ],
    }) as unknown as SpeciesDefinition;

  const problems = (grant: unknown): readonly string[] =>
    checkContent({ species: [speciesGranting(grant)] }).map((problem) => problem.code);

  it('is accepted where it names the one thing the book prints', () => {
    expect(problems({ kind: 'sees-through', through: 'darkness', feet: 120 })).toEqual([]);
  });

  it('refuses something no rule knows how to see through', () => {
    expect(problems({ kind: 'sees-through', through: 'walls', feet: 120 })).toContain(
      'bad_sees_through',
    );
  });

  /** A range of nothing reaches nobody, which is `sense_of_no_range`'s rule. */
  it('refuses a range that reaches nobody', () => {
    expect(problems({ kind: 'sees-through', through: 'darkness', feet: 0 })).toContain(
      'bad_sees_through_range',
    );
  });
});
