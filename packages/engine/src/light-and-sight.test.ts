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

  it("sees her in that same magical darkness with Devil's Sight", () => {
    const state = fold(
      'light',
      [
        added(id('tiefling'), { standing: [DEVILS_SIGHT] }),
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
    issuer: createRollIssuer(createRng('fog')),
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
    issuer: createRollIssuer(createRng('dark')),
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
