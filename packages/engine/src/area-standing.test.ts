import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { Bonus } from './bonuses.js';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import type { Point } from './positioning.js';
import { defensesOf, effectiveConditions, speedOf } from './standing.js';
import { checkBonuses } from './commands/rolls.js';
import { endConcentration, ongoingSpellOf, resolveMove, resolveSpell } from './commands.js';
import { checkSpellDefinitionValue } from './spell-schema.js';

/**
 * What a persistent area does to whoever is standing in it, for as long as
 * they stand in it.
 *
 * SRD Spirit Guardians: "Any other creature's Speed is **halved in the
 * Emanation**." Which creatures those are is a fact about where two creatures
 * are standing, and it changes every time either of them moves without
 * anything happening that a log could record — the argument `standing.ts`
 * already makes for a Paladin's aura, arriving at a casting's area.
 *
 * So the halving is **derived on every read** and nothing is ever stored on
 * the creature it reaches. A stored halving would be a pair of events that had
 * to stay matched — granted on the way in, released on the way out — and the
 * first route that moved a creature without remembering would leave a goblin
 * walking at half Speed a hundred feet from the cleric.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
/** Inside the Emanation from the moment it appears, and never designated. */
const WALKER = id('walker');
/** Outside it until the cleric takes one step east. */
const VICTIM = id('victim');
/** Inside it, and designated unaffected in the casting that names them. */
const ALLY = id('ally');

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
  weaponProficiencies: ['simple', 'martial'],
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 400,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === CLERIC || who === ALLY ? 'party' : 'foes',
});

const casts = (who: CharacterId): readonly GameEvent[] => [
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['spirit-guardians'] }),
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 8, recovers: 'long-rest' },
    }),
  ),
];

/**
 * The lane, measured against the engine's own ruler.
 *
 * A 15-foot Emanation on a Medium carrier standing at x = 300 covers
 * x ∈ [285, 315] and excludes the carrier's own space; one five-foot step east
 * takes it to [290, 320].
 */
const LANE = 300;
const CLERIC_AT: Point = { x: 300, y: LANE, z: 0 };
const ONE_STEP_EAST: Point = { x: 305, y: LANE, z: 0 };
const WALKER_AT: Point = { x: 315, y: LANE, z: 0 };
const VICTIM_AT: Point = { x: 320, y: LANE, z: 0 };
const ALLY_AT: Point = { x: 310, y: LANE, z: 0 };

const place = (who: CharacterId, at: Point): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { point: at }, feet: 0 },
});

const SETUP: readonly GameEvent[] = [
  added(CLERIC),
  added(WALKER),
  added(VICTIM),
  added(ALLY),
  ...casts(CLERIC),
  { type: 'scene-set', extent: { width: 900, depth: 900, height: 60 } },
  place(CLERIC, CLERIC_AT),
  place(WALKER, WALKER_AT),
  place(VICTIM, VICTIM_AT),
  place(ALLY, ALLY_AT),
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

class Game {
  constructor(private readonly events: GameEvent[] = [...SETUP]) {}

  get state(): GameState {
    return fold('seed', this.events);
  }

  get log(): readonly GameEvent[] {
    return this.events;
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  cast(unaffected: readonly CharacterId[] = []): string {
    const out = unwrap(
      resolveSpell(
        this.state,
        CLERIC,
        {
          spellId: 'spirit-guardians',
          targets: [],
          damageType: 'radiant',
          ...(unaffected.length === 0 ? {} : { unaffected }),
        },
        supply('spirit-guardians'),
      ),
      'casting Spirit Guardians',
    );
    this.push(out.events);
    return out.castingId!;
  }

  /** Shove a creature, which is the one route that moves one outside a turn. */
  shove(who: CharacterId, to: Point): this {
    const out = unwrap(
      resolveMove(
        this.state,
        who,
        { placement: { from: { point: to }, feet: 0 }, forced: true },
        supply('move'),
      ),
      `${who} moving`,
    );
    return this.push(out.events);
  }

  speeds(): Record<string, number> {
    const state = this.state;
    return {
      cleric: speedOf(state, CLERIC),
      walker: speedOf(state, WALKER),
      victim: speedOf(state, VICTIM),
      ally: speedOf(state, ALLY),
    };
  }
}

describe('a Speed halved by where a creature is standing', () => {
  it('halves the Speed of a creature inside the Emanation and nobody else', () => {
    const game = new Game();
    game.cast();

    expect(game.speeds()).toEqual({
      // SRD: an Emanation excludes its own origin, so the cleric is not in it.
      cleric: 30,
      // "Any other creature's Speed is halved in the Emanation" — any other,
      // so a creature the cleric is fighting beside is caught like the rest.
      walker: 15,
      ally: 15,
      // Five feet outside the Emanation, and untouched.
      victim: 30,
    });
  });

  it('follows the Emanation when the caster moves, with no event in between', () => {
    const game = new Game();
    game.cast();
    expect(game.speeds().victim).toBe(30);

    game.shove(CLERIC, ONE_STEP_EAST);

    expect(game.speeds()).toEqual({ cleric: 30, walker: 15, victim: 15, ally: 15 });
    // Nothing was granted to anybody: the halving is derived from the scene on
    // every read, so no pair of events has to stay matched.
    expect(game.log.some((e) => e.type === 'speed-modifier-granted')).toBe(false);
  });

  it('spares a creature the caster designated unaffected at the cast', () => {
    const game = new Game();
    game.cast([ALLY]);

    // One decision, filtered where the area is read, so it reaches the halving
    // and the saving throw alike — and it is the caster's list rather than the
    // declared sides: `ally` and `walker` are both in the Emanation.
    expect(game.speeds()).toEqual({ cleric: 30, walker: 15, victim: 30, ally: 30 });
  });

  it('hands the Speed back when the casting ends', () => {
    const game = new Game();
    const castingId = game.cast();
    expect(game.speeds().walker).toBe(15);

    game.push(unwrap(endConcentration(game.state, CLERIC, 'voluntary'), 'ending it'));

    expect(ongoingSpellOf(game.state, castingId)).toBeNull();
    expect(game.speeds()).toEqual({ cleric: 30, walker: 30, victim: 30, ally: 30 });
    expect(game.log.some((e) => e.type === 'speed-modifier-granted')).toBe(false);
  });

  it('pins what the area does to whoever stands in it onto the casting', () => {
    const game = new Game();
    const castingId = game.cast();

    // The fold never opens the catalogue, so the standing effect an area has is
    // recorded at the cast beside the area it is measured over.
    expect(ongoingSpellOf(game.state, castingId)?.areaStanding).toEqual([
      { kind: 'speed', change: 'halve' },
    ]);
  });
});

describe('what the validator holds a standing area effect to', () => {
  const NO_AREA = Symbol('no area');
  const definition = (
    areaStanding: unknown,
    area: unknown = { kind: 'sphere', radius: 15, origin: 'point' },
  ) => ({
    id: 'homebrew-zone',
    name: 'Homebrew Zone',
    level: 2,
    school: 'evocation',
    castingTime: 'action',
    concentration: true,
    range: { kind: 'ranged', feet: 60 },
    targets: { count: 0 },
    effects: [],
    durationSeconds: 60,
    // A definition whose `effects` are empty says what it leaves to the table,
    // which Spirit Guardians does too: the zone is the whole of the spell.
    unmodelled: ['what the zone looks like'],
    ...(area === NO_AREA ? {} : { area }),
    areaStanding,
  });

  const codes = (value: unknown): readonly string[] =>
    checkSpellDefinitionValue(value).map((p) => `${p.field}:${p.code}`);

  it('accepts the sentence Spirit Guardians writes', () => {
    expect(codes(definition([{ kind: 'speed', change: 'halve' }]))).toEqual([]);
  });

  it('refuses a standing effect on a spell with no area to stand in', () => {
    expect(codes(definition([{ kind: 'speed', change: 'halve' }], NO_AREA))).toContain(
      'areaStanding:standing_without_area',
    );
  });

  it('refuses a kind the engine derives nothing from', () => {
    expect(codes(definition([{ kind: 'cannot-lie' }]))).toContain(
      'areaStanding[0].kind:unknown_area_standing',
    );
  });

  it('holds the Speed pairing to the rule every other carrier is held to', () => {
    // `halve` names the whole operation, so feet beside it are read by nothing;
    // `add` without them is a change of nothing.
    expect(codes(definition([{ kind: 'speed', change: 'halve', feet: 10 }]))).toContain(
      'areaStanding[0].feet:bad_speed_change',
    );
    expect(codes(definition([{ kind: 'speed', change: 'add' }]))).toContain(
      'areaStanding[0].feet:bad_speed_change',
    );
    expect(codes(definition([{ kind: 'speed', change: 'sprint' }]))).toContain(
      'areaStanding[0].change:bad_speed_change',
    );
  });

  it('refuses a lone clause where the format holds a list of them', () => {
    // SRD Silence writes three about one Sphere, so the field grew an arity.
    // A record written before it means a list of one and `upgradeOngoing` says
    // so; a *definition* written now is held to the shape the format has.
    expect(codes(definition({ kind: 'speed', change: 'halve' }))).toContain(
      'areaStanding:standing_is_a_list',
    );
  });

  it('holds "entirely inside" to the narrowing a clause either prints or does not', () => {
    expect(
      codes(definition([{ kind: 'condition', condition: 'deafened', whollyInside: false }])),
    ).toContain('areaStanding[0].whollyInside:bad_wholly_inside');
  });

  it('holds an area bonus to the one family a gatherer reaches', () => {
    // Widening `applies` would be a bonus no roll ever reads, which is the
    // failure the content validator exists to prevent.
    expect(
      codes(definition([{ kind: 'bonus', applies: 'save', flat: 10, only: { skill: 'stealth' } }])),
    ).toContain('areaStanding[0].applies:unreadable_area_bonus');
    // And a bonus of no points is no bonus, which is the `speed` member's own
    // reading of a change of no feet.
    expect(codes(definition([{ kind: 'bonus', applies: 'ability-check', flat: 0 }]))).toContain(
      'areaStanding[0].flat:bad_area_bonus',
    );
    // The narrowing is `bonusesFor`'s and is held to its own pairing: an
    // ability on an ability check is a filter `checkBonuses` is never handed.
    expect(
      codes(
        definition([{ kind: 'bonus', applies: 'ability-check', flat: 10, only: { ability: 'dex' } }]),
      ).join(' '),
    ).toContain('narrowing_unreadable');
  });

  it('holds a condition and a defence to the vocabularies the engine already has', () => {
    expect(codes(definition([{ kind: 'condition', condition: 'bemused' }]))).toContain(
      'areaStanding[0].condition:unknown_condition',
    );
    expect(
      codes(definition([{ kind: 'damage-defense', defense: 'allergic', damageTypes: ['thunder'] }])),
    ).toContain('areaStanding[0].defense:bad_damage_defense');
    expect(
      codes(definition([{ kind: 'damage-defense', defense: 'immune', damageTypes: [] }])),
    ).toContain('areaStanding[0].damageTypes:bad_damage_defense');
    expect(
      codes(definition([{ kind: 'damage-defense', defense: 'immune', damageTypes: ['boredom'] }])),
    ).toContain('areaStanding[0].damageTypes[0]:unknown_damage_type');
  });

  it('accepts the three sentences Silence writes about one Sphere', () => {
    expect(
      codes(
        definition([
          { kind: 'damage-defense', defense: 'immune', damageTypes: ['thunder'], whollyInside: true },
          { kind: 'condition', condition: 'deafened', whollyInside: true },
          { kind: 'no-verbal-casting' },
        ]),
      ),
    ).toEqual([]);
  });
});

describe('what the validator holds the list a caster chooses to', () => {
  const definition = (over: Record<string, unknown>) => ({
    id: 'homebrew-aura',
    name: 'Homebrew Aura',
    level: 2,
    school: 'abjuration',
    castingTime: 'action',
    concentration: true,
    range: { kind: 'self' },
    targets: { count: 0 },
    effects: [],
    durationSeconds: 60,
    unmodelled: ['what the aura looks like'],
    ...over,
  });

  const codes = (value: unknown): readonly string[] =>
    checkSpellDefinitionValue(value).map((p) => `${p.field}:${p.code}`);

  it('refuses a list of who an area reaches on a spell with no area', () => {
    expect(codes(definition({ designatesChosen: true }))).toContain(
      'designatesChosen:chosen_without_area',
    );
  });

  it('refuses a spell that names both polarities of one decision', () => {
    expect(
      codes(
        definition({
          area: { kind: 'emanation', distance: 30, origin: 'self', includesOrigin: true },
          designatesChosen: true,
          designatesUnaffected: true,
          areaStanding: [{ kind: 'bonus', applies: 'ability-check', flat: 10 }],
        }),
      ),
    ).toContain('designatesChosen:both_polarities');
  });
});

// — the other three things an area does to whoever is standing in it ————————
//
// SRD Pass without Trace: "You radiate a concealing aura in a 30-foot
// Emanation for the duration. While in the aura, you and each creature you
// choose have a +10 bonus to Dexterity (Stealth) checks and leave no tracks."
//
// SRD Silence: "no sound can be created within or pass through a
// 20-foot-radius Sphere centered on a point you choose within range. Any
// creature or object entirely inside the Sphere has Immunity to Thunder
// damage, and creatures have the Deafened condition while entirely inside it.
// Casting a spell that includes a Verbal component is impossible there."
//
// Four sentences: three of them derived on every read exactly as the halved
// Speed above is — a bonus, a condition and a defence — and one of them a
// refusal at the moment somebody casts.

const RANGER = id('ranger');
const ROGUE = id('rogue');
const FIGHTER = id('fighter');
const PRIEST = id('priest');
const GOBLIN = id('goblin');
/** Large, and standing with one corner of itself outside the Sphere. */
const OGRE = id('ogre');
/** Outside the Sphere, so the Thunderwave it throws is not itself silenced. */
const BOOMER = id('boomer');

const caster = (who: CharacterId, prepared: readonly string[]): readonly GameEvent[] => [
  {
    type: 'creature-added',
    id: who,
    name: who,
    sheet: sheet(),
    maxHp: 400,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'party',
  },
  ...(prepared.length === 0
    ? []
    : [
        {
          type: 'spellcasting-declared',
          id: who,
          spellcasting: declaredCasting({ ability: 'wis', prepared }),
        } as GameEvent,
        ...[1, 2, 3].map(
          (level): GameEvent => ({
            type: 'resource-pool-declared',
            id: who,
            pool: {
              key: `spell-slot:${level}`,
              label: `level ${level}`,
              max: 8,
              recovers: 'long-rest',
            },
          }),
        ),
      ]),
];

/**
 * The second lane, measured against the same ruler.
 *
 * The aura is a 30-foot Emanation on a Medium carrier at x = 300, so it covers
 * x ∈ [270, 335] — and the carrier too, because SRD excludes an Emanation's
 * own origin "unless its creator decides otherwise" and this sentence decides
 * otherwise.
 */
const AURA_LANE = 300;
const RANGER_AT: Point = { x: 300, y: AURA_LANE, z: 0 };
const ROGUE_AT: Point = { x: 310, y: AURA_LANE, z: 0 };
const FIGHTER_AT: Point = { x: 315, y: AURA_LANE, z: 0 };
/** Thirty-five feet from the Ranger's own space, which is five feet too far. */
const ROGUE_FAR: Point = { x: 340, y: AURA_LANE, z: 0 };
/** Forty feet on, with the Rogue a single step behind. */
const RANGER_WALKED: Point = { x: 340, y: AURA_LANE, z: 0 };
const ROGUE_FOLLOWED: Point = { x: 350, y: AURA_LANE, z: 0 };

/**
 * The third lane: a 20-foot-radius Sphere centred on the space at x = 500.
 *
 * A Medium creature at x = 520 is exactly twenty feet from that centre and is
 * wholly inside it; a Large one anchored at x = 520, y = 520 occupies four
 * spaces, the furthest of which is twenty-five feet out — so it is *in* the
 * Sphere and is not *entirely inside* it.
 */
const SILENT_LANE = 500;
const SILENCE_AT: Point = { x: 500, y: SILENT_LANE, z: 0 };
const PRIEST_AT: Point = { x: 470, y: SILENT_LANE, z: 0 };
const GOBLIN_AT: Point = { x: 520, y: SILENT_LANE, z: 0 };
const OGRE_AT: Point = { x: 520, y: SILENT_LANE + 20, z: 0 };
const BOOMER_AT: Point = { x: 535, y: SILENT_LANE, z: 0 };
/** Thirty feet from the centre, and out of the Sphere altogether. */
const GOBLIN_OUT: Point = { x: 530, y: SILENT_LANE, z: 0 };

const AREA_SETUP: readonly GameEvent[] = [
  ...caster(RANGER, ['pass-without-trace']),
  ...caster(ROGUE, []),
  ...caster(FIGHTER, []),
  ...caster(PRIEST, ['silence']),
  ...caster(GOBLIN, ['thunderwave', 'minor-illusion']),
  ...caster(OGRE, []),
  ...caster(BOOMER, ['thunderwave']),
  { type: 'scene-set', extent: { width: 900, depth: 900, height: 60 } },
  place(RANGER, RANGER_AT),
  place(ROGUE, ROGUE_AT),
  place(FIGHTER, FIGHTER_AT),
  place(PRIEST, PRIEST_AT),
  place(GOBLIN, GOBLIN_AT),
  // A Large creature occupies four spaces, which is the whole of what makes
  // it a straddler: the near one is inside the Sphere and the far one is not.
  { type: 'creature-placed', id: OGRE, placement: { from: { point: OGRE_AT }, feet: 0, size: 'large' } },
  place(BOOMER, BOOMER_AT),
];

class Lane {
  constructor(private readonly events: GameEvent[] = [...AREA_SETUP]) {}

  get state(): GameState {
    return fold('seed', this.events);
  }

  get log(): readonly GameEvent[] {
    return this.events;
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  cast(who: CharacterId, request: Record<string, unknown>, label: string): string {
    const out = unwrap(
      resolveSpell(this.state, who, request as never, supply(label)),
      `casting ${label}`,
    );
    this.push(out.events);
    return out.castingId!;
  }

  shove(who: CharacterId, to: Point): this {
    const out = unwrap(
      resolveMove(
        this.state,
        who,
        { placement: { from: { point: to }, feet: 0 }, forced: true },
        supply('move'),
      ),
      `${who} moving`,
    );
    return this.push(out.events);
  }

  stealth(who: CharacterId): readonly Bonus[] {
    return [...checkBonuses(this.state, who, undefined, 'stealth')];
  }
}

const passWithoutTrace = (lane: Lane, chosen: readonly CharacterId[]): string =>
  lane.cast(RANGER, { spellId: 'pass-without-trace', targets: [], chosen }, 'pass-without-trace');

const silence = (lane: Lane): string =>
  lane.cast(PRIEST, { spellId: 'silence', targets: [], at: SILENCE_AT }, 'silence');

describe('a bonus an area gives whoever stands in it and is on its list', () => {
  it('reaches the creature the caster named, inside the aura, and nobody else', () => {
    const lane = new Lane();
    passWithoutTrace(lane, [ROGUE]);

    expect(lane.stealth(ROGUE)).toEqual([{ source: 'Pass without Trace', flat: 10 }]);
    // "you and each creature you choose": the Fighter is in the aura and off
    // the list, so the aura conceals them not at all.
    expect(lane.stealth(FIGHTER)).toEqual([]);
    // "**you** and each creature you choose" — the caster is always on it, and
    // is in their own aura because the sentence says so rather than because the
    // geometry puts them there.
    expect(lane.stealth(RANGER)).toEqual([{ source: 'Pass without Trace', flat: 10 }]);
  });

  it('reaches its caster and nobody else when the caster chose nobody', () => {
    const lane = new Lane();
    const castingId = passWithoutTrace(lane, []);

    // "**you** and each creature you choose", with nobody chosen. An empty
    // list is not an absent one here, which is where this fact parts company
    // with the designation it mirrors: eliding it would hand the aura to
    // whoever the geometry caught, which is the rule inverted rather than
    // narrowed.
    expect(lane.stealth(RANGER)).toEqual([{ source: 'Pass without Trace', flat: 10 }]);
    expect(lane.stealth(ROGUE)).toEqual([]);
    expect(lane.stealth(FIGHTER)).toEqual([]);
    // And the list really is pinned rather than merely read as empty: absence
    // on the record would mean the spell offers no such clause at all.
    expect(ongoingSpellOf(lane.state, castingId)?.chosen).toEqual([RANGER]);
  });

  it('withholds the bonus from a check it does not name', () => {
    const lane = new Lane();
    passWithoutTrace(lane, [ROGUE]);
    // "a +10 bonus to Dexterity (Stealth) checks", and to nothing else — and a
    // caller with no skill to name gets only the bonuses that name none.
    expect(checkBonuses(lane.state, ROGUE, undefined, 'perception')).toEqual([]);
    expect(checkBonuses(lane.state, ROGUE, undefined)).toEqual([]);
  });

  it('stops at the edge of the Emanation, on the list or not', () => {
    const lane = new Lane();
    lane.shove(ROGUE, ROGUE_FAR);
    passWithoutTrace(lane, [ROGUE]);

    expect(lane.stealth(ROGUE)).toEqual([]);
  });

  it('travels with the caster, with nothing hung on anybody', () => {
    const lane = new Lane();
    passWithoutTrace(lane, [ROGUE]);

    lane.shove(RANGER, RANGER_WALKED);
    lane.shove(ROGUE, ROGUE_FOLLOWED);

    expect(lane.stealth(ROGUE)).toEqual([{ source: 'Pass without Trace', flat: 10 }]);
    // Forty feet on, and nothing was granted or released: the bonus is derived
    // from the scene on every read and stored on nobody.
    expect(lane.state.creatures[ROGUE]?.bonuses ?? []).toEqual([]);
  });

  it('pins the list the caster stated onto the casting', () => {
    const lane = new Lane();
    const castingId = passWithoutTrace(lane, [ROGUE]);

    expect(ongoingSpellOf(lane.state, castingId)?.chosen).toEqual([RANGER, ROGUE]);
    expect(ongoingSpellOf(lane.state, castingId)?.areaStanding).toEqual([
      { kind: 'bonus', applies: 'ability-check', flat: 10, only: { skill: 'stealth' } },
    ]);
  });

  it('refuses a list on a spell that offers the caster no such choice', () => {
    const lane = new Lane();
    const refused = resolveSpell(
      lane.state,
      BOOMER,
      { spellId: 'thunderwave', targets: [], towards: GOBLIN_AT, chosen: [GOBLIN] } as never,
      supply('thunderwave'),
    );
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('no_chosen_list');
  });
});

describe('a condition and a defence a creature entirely inside an area has', () => {
  it('deafens a creature entirely inside the Sphere and not one straddling it', () => {
    const lane = new Lane();
    silence(lane);

    expect(effectiveConditions(lane.state, GOBLIN).conditions).toContain('deafened');
    // "while entirely inside it": the ogre occupies four spaces and one of them
    // is outside, so the Sphere reaches it with neither clause.
    expect(effectiveConditions(lane.state, OGRE).conditions).not.toContain('deafened');
    // Nothing was written: presence is the whole of the cause, so there is no
    // application to record and nothing to take back.
    expect(lane.log.some((e) => e.type === 'condition-applied')).toBe(false);
  });

  it('makes a creature entirely inside immune to Thunder damage', () => {
    const lane = new Lane();
    silence(lane);

    expect(defensesOf(lane.state, GOBLIN)['thunder']).toEqual({ immune: true });
    expect(defensesOf(lane.state, OGRE)['thunder']).toBeUndefined();
  });

  it('turns a Thunderwave aside entirely', () => {
    const lane = new Lane();
    silence(lane);
    const before = lane.state.creatures[GOBLIN]!.vitals.hp;

    lane.cast(BOOMER, { spellId: 'thunderwave', targets: [], towards: GOBLIN_AT }, 'thunderwave');

    expect(lane.state.creatures[GOBLIN]!.vitals.hp).toBe(before);
  });

  it('lets both go the moment the creature walks out, writing nothing', () => {
    const lane = new Lane();
    silence(lane);
    expect(effectiveConditions(lane.state, GOBLIN).conditions).toContain('deafened');
    const before = lane.log.length;

    lane.shove(GOBLIN, GOBLIN_OUT);

    expect(effectiveConditions(lane.state, GOBLIN).conditions).not.toContain('deafened');
    expect(defensesOf(lane.state, GOBLIN)['thunder']).toBeUndefined();
    expect(
      lane.log
        .slice(before)
        .some((e) => e.type === 'condition-applied' || e.type === 'condition-removed'),
    ).toBe(false);
  });
});

describe('the casting an area refuses', () => {
  it('refuses a spell with a Verbal component to a caster inside the Sphere', () => {
    const lane = new Lane();
    silence(lane);

    const refused = resolveSpell(
      lane.state,
      GOBLIN,
      { spellId: 'thunderwave', targets: [], towards: SILENCE_AT } as never,
      supply('thunderwave'),
    );
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('silenced');
  });

  it('lets a spell that includes no Verbal component be cast there', () => {
    const lane = new Lane();
    silence(lane);

    // SRD Minor Illusion prints "S, M" and no V, which is why it is the one
    // sentence of Silence's four that reads a component at all.
    const cast = resolveSpell(
      lane.state,
      GOBLIN,
      { spellId: 'minor-illusion', targets: [] } as never,
      supply('minor-illusion'),
    );
    expect(isErr(cast)).toBe(false);
  });

  it('lets a caster outside the Sphere speak', () => {
    const lane = new Lane();
    silence(lane);

    const cast = resolveSpell(
      lane.state,
      BOOMER,
      { spellId: 'thunderwave', targets: [], towards: GOBLIN_AT } as never,
      supply('thunderwave'),
    );
    expect(isErr(cast)).toBe(false);
  });
});
