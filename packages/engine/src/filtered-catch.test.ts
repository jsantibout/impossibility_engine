import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { terrainAt, type Point } from './positioning.js';
import {
  availableChecks,
  eligibleTargets,
  endOngoingSpell,
  resolveEffectCheck,
  resolveSpell,
  type CastSpellRequest,
} from './commands.js';

/**
 * Three SRD sentences that narrow what an area catches.
 *
 * An area of effect catches whoever is standing in it, and for most of the
 * book that is the whole rule. Three spells print a clause that shrinks the
 * catch before a single save is rolled, and each one narrows it on a different
 * axis:
 *
 * | Spell | The clause | The field |
 * |---|---|---|
 * | Entangle | "Each creature **(other than you)** in the area" | `notTheCaster` |
 * | Hypnotic Pattern | "Each creature in the area **who can see the pattern**" | `mustSeeTheOrigin` |
 * | Sleep | "Each creature **of your choice** in a 5-foot-radius Sphere" | `chosenFromTheArea` |
 *
 * All three are read at the one seam where an area settles its catch, so
 * everything downstream — the save, the damage, the riders, the record — sees
 * the filtered list and knows nothing about the filter. What this file holds
 * is that they narrow the catch and nothing else: a druid standing in their
 * own plants has cast a legal spell, a blind goblin in the Cube is not
 * Charmed, and a Sleep with nobody named is a question rather than a slot
 * spent on the party.
 *
 * **And the ruling on the sight question, which is the one decision here.**
 * Sight in this engine is declared *between two creatures*; a pattern is at a
 * point, and no table can declare a line to a patch of air. So where nobody
 * has said, the creature is **caught and the outcome names the question** —
 * the ruling SRD Faerie Fire's "if the attacker can see it" already takes, and
 * the opposite of reading a silence as a no and quietly shrinking the spell.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const ALLY = id('ally');
const GOBLIN = id('goblin');
const HOBGOBLIN = id('hobgoblin');
const SLEEPER = id('sleeper');
const OUTSIDER = id('outsider');

/**
 * Wis 20 (+5), level 9 (Proficiency +4). Spell save DC 8 + 4 + 5 = **17**.
 *
 * Written out because the escape check below is arithmetic off this sheet.
 */
const SAVE_DC = 17;

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 20, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  ...over,
});

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 80,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === CASTER || who === ALLY ? 'party' : 'foes',
});

/**
 * The geometry, worked out once against the engine's own ruler.
 *
 * `AT` is the point every area in this file is centred on. A Cube runs 20 feet
 * along the axis it is pointed down, so `TOWARDS` is east and the spaces east
 * of `AT` are inside it while the spaces west of it are not; `AWAY` is far
 * enough off that no template here reaches it. The Sphere is 5 feet and covers
 * `AT` and its immediate neighbours in every direction, which is why the two
 * templates catch overlapping but different crowds.
 */
const HALL: Point = { x: 200, y: 200, z: 0 };
const AT: Point = { x: 240, y: 200, z: 0 };
const TOWARDS: Point = { x: 300, y: 200, z: 0 };
const AWAY: Point = { x: 400, y: 200, z: 0 };

const spot = (name: string, at: Point): GameEvent => ({ type: 'landmark-added', name, at });

const at = (who: CharacterId, landmark: string): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { landmark }, feet: 0 },
});

const SETUP: readonly GameEvent[] = [
  added(CASTER),
  added(ALLY),
  added(GOBLIN),
  added(HOBGOBLIN),
  added(SLEEPER),
  added(OUTSIDER),
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CASTER,
      pool: { key: spellSlotKey(level), label: `level ${level}`, max: 6, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 60 } },
  spot('the hall', HALL),
  spot('the point', AT),
  spot('one east', { x: 245, y: 200, z: 0 }),
  spot('two east', { x: 250, y: 200, z: 0 }),
  spot('three east', { x: 255, y: 200, z: 0 }),
  spot('one west', { x: 235, y: 200, z: 0 }),
  // In the Sphere and out of the Cube, which is how the Sleep block below gets
  // a third creature to choose between without changing Entangle's catch.
  spot('north-west', { x: 235, y: 205, z: 0 }),
  spot('far off', AWAY),
  // The caster stands in the square they are about to fill, which is the whole
  // of what Entangle's parenthesis is about.
  at(CASTER, 'one east'),
  at(ALLY, 'two east'),
  at(GOBLIN, 'three east'),
  at(HOBGOBLIN, 'one west'),
  at(SLEEPER, 'north-west'),
  at(OUTSIDER, 'far off'),
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'druid',
      prepared: SPELL_DEFINITIONS.filter((d) => d.level > 0).map((d) => d.id),
    }),
  },
];

const supply = (seed = 'catch', bonuses?: readonly { source: string; flat: number }[]) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  ...(bonuses === undefined ? {} : { bonuses }),
});

/** Every save fails, so nothing under test depends on a die. */
const FORCED = [{ source: 'the fixture', flat: -40 }];

const castOn = (
  log: readonly GameEvent[],
  request: Omit<CastSpellRequest, 'targets'> & { readonly targets?: readonly CharacterId[] },
  bonuses?: readonly { source: string; flat: number }[],
) =>
  resolveSpell(
    fold('seed', log),
    CASTER,
    { targets: [], ...request },
    supply(request.spellId, bonuses),
  );

const caught = (outcomes: readonly { readonly target: CharacterId }[]) =>
  outcomes.map((outcome) => outcome.target).sort();

describe('SRD Entangle: "Each creature (other than you) in the area"', () => {
  /** The 20-foot square, its Strength save, and the druid left standing. */
  const entangled = (seed = 'plants') => {
    const out = unwrap(
      resolveSpell(
        fold('seed', SETUP),
        CASTER,
        { spellId: 'entangle', targets: [], at: AT, towards: TOWARDS, slotLevel: 1 },
        supply(seed, FORCED),
      ),
      'entangle',
    );
    return { out, log: [...SETUP, ...out.events] };
  };

  it('catches everybody in the square but the caster', () => {
    const { out } = entangled();
    // The caster is standing one space into their own plants: in the Cube by
    // the geometry, and out of the catch by the parenthesis.
    expect(caught(out.outcomes)).toEqual([ALLY, GOBLIN].sort());
    expect(caught(out.outcomes)).not.toContain(CASTER);
    // A filter, never a refusal: the casting is legal and the slot is spent.
    expect(out.castingId).not.toBeNull();
  });

  it('rolls the Strength save for each of them and Restrains the failures', () => {
    const { out, log } = entangled();
    for (const outcome of out.outcomes) {
      expect(outcome.save?.ability).toBe('str');
      expect(outcome.save?.success).toBe(false);
    }
    const state = fold('seed', log);
    expect(state.creatures[ALLY]?.conditions.conditions).toContain('restrained');
    expect(state.creatures[GOBLIN]?.conditions.conditions).toContain('restrained');
    expect(state.creatures[CASTER]?.conditions.conditions ?? []).not.toContain('restrained');
  });

  /**
   * SRD: "A Restrained creature can take an action to make a Strength
   * (Athletics) check against your spell save DC. On a success, it frees
   * itself ... and is no longer Restrained by them." On itself — the ally goes
   * on struggling.
   */
  it('offers the Athletics escape, and a success frees that one creature alone', () => {
    const { log } = entangled();
    const state = fold('seed', log);
    const checks = availableChecks(state, GOBLIN);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.ability).toBe('str');
    expect(checks[0]?.skill).toBe('athletics');
    expect(checks[0]?.dc).toBe(SAVE_DC);
    expect(checks[0]?.onSuccess).toBe('end-on-target');

    const freed = unwrap(
      resolveEffectCheck(
        state,
        GOBLIN,
        { effectKey: checks[0]!.effectKey },
        supply('escape', [{ source: 'a mighty heave', flat: 40 }]),
      ),
      'escape',
    );
    expect(freed.success).toBe(true);
    const after = fold('seed', [...log, ...freed.events]);
    expect(after.creatures[GOBLIN]?.conditions.conditions ?? []).not.toContain('restrained');
    expect(after.creatures[ALLY]?.conditions.conditions).toContain('restrained');
  });

  it('leaves a failed escape exactly where it was', () => {
    const { log } = entangled();
    const state = fold('seed', log);
    const key = availableChecks(state, GOBLIN)[0]!.effectKey;
    const held = unwrap(
      resolveEffectCheck(
        state,
        GOBLIN,
        { effectKey: key },
        supply('stuck', [{ source: 'a weak heave', flat: -40 }]),
      ),
      'escape',
    );
    expect(held.success).toBe(false);
    expect(
      fold('seed', [...log, ...held.events]).creatures[GOBLIN]?.conditions.conditions,
    ).toContain('restrained');
  });

  /** The Concentration goes and the plants let go of everybody at once. */
  it('frees everyone when the casting ends', () => {
    const { out, log } = entangled();
    const ended = unwrap(
      endOngoingSpell(fold('seed', log), CASTER, out.castingId!, null),
      'ending entangle',
    );
    const after = fold('seed', [...log, ...ended]);
    expect(after.creatures[ALLY]?.conditions.conditions ?? []).not.toContain('restrained');
    expect(after.creatures[GOBLIN]?.conditions.conditions ?? []).not.toContain('restrained');
  });

  /**
   * "these plants turn the ground in the area into Difficult Terrain ... They
   * disappear when the spell ends" — `areaTerrain`, at the glossary's rate, on
   * a patch that lapses with the casting because it names it.
   */
  it('makes the ground Difficult Terrain for as long as it lasts', () => {
    const { out, log } = entangled();
    expect(terrainAt(fold('seed', log), { x: 250, y: 200, z: 0 }).costPerFoot).toBe(2);
    expect(terrainAt(fold('seed', log), AWAY).costPerFoot).toBe(1);

    const ended = unwrap(
      endOngoingSpell(fold('seed', log), CASTER, out.castingId!, null),
      'ending entangle',
    );
    expect(
      terrainAt(fold('seed', [...log, ...ended]), { x: 250, y: 200, z: 0 }).costPerFoot,
    ).toBe(1);
  });

  /** Nothing of this spell is handed back unbuilt. */
  it('leaves nothing unmodelled', () => {
    expect(SRD_CONTENT.spell('entangle')?.unmodelled ?? []).toEqual([]);
  });
});

describe('SRD Hypnotic Pattern: "each creature in the area who can see the pattern"', () => {
  const BLINDED: readonly GameEvent[] = [
    {
      type: 'condition-applied',
      id: ALLY,
      condition: 'blinded',
      source: 'a faceful of sand',
    },
  ];

  /** A bank of fog the table declared, sitting exactly over the pattern. */
  const FOG: readonly GameEvent[] = [
    {
      type: 'obscurement-declared',
      patch: 'a bank of fog',
      region: { origin: { space: AT }, shape: { kind: 'sphere', radius: 5 } },
      degree: 'heavily',
    },
  ];

  /** Truesight far enough to reach the pattern through anything. */
  const TRUESEEING: readonly GameEvent[] = [
    {
      type: 'sense-granted',
      id: GOBLIN,
      modifier: { source: 'a crystal eye', sense: 'truesight', feet: 120 },
    },
  ];

  const pattern = (log: readonly GameEvent[]) =>
    unwrap(
      resolveSpell(
        fold('seed', log),
        CASTER,
        { spellId: 'hypnotic-pattern', targets: [], at: AT, towards: TOWARDS, slotLevel: 3 },
        supply('pattern', FORCED),
      ),
      'hypnotic-pattern',
    );

  it('does not catch a creature that cannot see at all', () => {
    const out = pattern([...SETUP, ...BLINDED]);
    expect(caught(out.outcomes)).not.toContain(ALLY);
    expect(caught(out.outcomes)).toContain(GOBLIN);
    // And this spell prints no parenthesis, so its caster stares at their own
    // pattern — which is the contrast that says `notTheCaster` is Entangle's
    // sentence rather than something an area does by default.
    expect(caught(out.outcomes)).toContain(CASTER);
  });

  /**
   * Nobody has said whether the goblin can see the point the Cube was laid on,
   * and about a point nobody can: the declaration this engine keeps is between
   * two creatures. So the clause is applied in the direction that does not
   * shrink the spell, and the casting says out loud that it did.
   */
  it('catches a creature nobody has spoken about, and names the question', () => {
    const out = pattern(SETUP);
    expect(caught(out.outcomes)).toEqual([ALLY, CASTER, GOBLIN].sort());
    expect(out.unverified.some((line) => line.includes(GOBLIN) && line.includes('can see'))).toBe(
      true,
    );
  });

  /**
   * And the other end: what *can* settle the question about a place is the
   * lattice. A bank of fog over the pattern hides it from anybody whose senses
   * do not reach through — and from nobody whose senses do.
   */
  it('does not catch a creature the fog over the pattern hides it from', () => {
    const out = pattern([...SETUP, ...FOG, ...TRUESEEING]);
    // Truesight sees "without relying on physical sight", so the goblin is
    // caught and the question about it is settled rather than reported.
    expect(caught(out.outcomes)).toEqual([GOBLIN]);
    expect(out.unverified.some((line) => line.includes(GOBLIN) && line.includes('can see'))).toBe(
      false,
    );
  });

  /** Its other clause is still the table's, and still handed over. */
  it('still hands over the shake-awake and claims nothing about sight', () => {
    const gaps = SRD_CONTENT.spell('hypnotic-pattern')?.unmodelled ?? [];
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain('shake');
  });
});

describe('SRD Sleep: "each creature of your choice in a 5-foot-radius Sphere"', () => {
  /** The Sphere covers the point and its neighbours: the caster and two more. */
  const sleep = (targets: readonly CharacterId[]) =>
    castOn(SETUP, { spellId: 'sleep', targets, at: AT, slotLevel: 1 }, FORCED);

  it('catches the two the caster named and leaves the third standing', () => {
    const out = unwrap(sleep([HOBGOBLIN, SLEEPER]), 'sleep');
    expect(caught(out.outcomes)).toEqual([HOBGOBLIN, SLEEPER].sort());
    // The caster is inside the Sphere and was not chosen, which is the whole
    // of what the clause buys: an area that would otherwise sleep the party.
    expect(caught(out.outcomes)).not.toContain(CASTER);
  });

  it('refuses a creature named from outside the Sphere', () => {
    const out = sleep([OUTSIDER]);
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('not_in_the_area');
  });

  /**
   * A choice the spell prints and the caster has not made, answered the way
   * `choice_required` answers its own: the engine names the options and will
   * not pick between them. Reading the silence as "nobody" would put every
   * casting written before this clause quietly to sleep on no one.
   */
  it('asks which of them, rather than catching all of them or none', () => {
    const out = sleep([]);
    expect(isErr(out)).toBe(true);
    if (isErr(out)) {
      expect(out.code).toBe('area_choice_required');
      expect(out.reason).toContain(String(HOBGOBLIN));
      expect(out.reason).toContain(String(SLEEPER));
    }
  });

  /**
   * A set, exactly as a named target list is: one effect list runs per
   * creature, so a creature chosen twice would be a second save, a second
   * condition and a second rider.
   */
  it('refuses the same creature chosen twice', () => {
    const out = sleep([HOBGOBLIN, HOBGOBLIN]);
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('duplicate_target');
  });

  it('no longer says the filter is unbuilt', () => {
    const gaps = SRD_CONTENT.spell('sleep')?.unmodelled ?? [];
    expect(gaps).toHaveLength(2);
    expect(gaps.some((gap) => gap.includes('of your choice'))).toBe(false);
  });
});

describe('the filters narrow a catch and nothing else', () => {
  /**
   * An area with no filter is untouched: Web still fills its Cube without
   * asking anybody what they can see, and still refuses a target list.
   */
  it('leaves an area with no filter asking nothing, and taking no list', () => {
    const state: GameState = fold('seed', SETUP);
    const out = unwrap(
      resolveSpell(
        state,
        CASTER,
        { spellId: 'web', targets: [], at: AT, towards: TOWARDS, slotLevel: 2 },
        supply('web'),
      ),
      'web',
    );
    expect(out.unverified.some((line) => line.includes('can see'))).toBe(false);

    const listed = castOn(SETUP, {
      spellId: 'web',
      targets: [GOBLIN],
      at: AT,
      towards: TOWARDS,
      slotLevel: 2,
    });
    expect(isErr(listed)).toBe(true);
    if (isErr(listed)) expect(listed.code).toBe('area_picks_its_own_targets');
  });
});

/**
 * The shortlist a model's door reads is the catch the casting settles.
 *
 * `eligibleTargets` answers "whom could this caster aim this spell at", and
 * for an area spell it used to know nothing whatever about the area: it
 * excluded the caster because the spell's target line prints no `self`, and it
 * listed every creature inside the spell's *Range* — which for Sleep is sixty
 * feet around a five-foot Sphere. So the door offered creatures the casting
 * then refused with `not_in_the_area`, and left off the one the Sphere really
 * does catch. A shortlist that disagrees with its own refusal is worse than no
 * shortlist, because a caller acts on it.
 *
 * It answers through `areaCatch` now — the same function the casting settles
 * its catch with, narrowed by the same three clauses — so the two cannot
 * drift. What it needs from the caller is the one thing the catch turns on and
 * the spell does not print: **where the area is laid**. Absent, it says so as
 * a `route` request rather than guessing a point, which is the same answer
 * `resolveSpell` gives the same caller.
 */
describe('the shortlist knows the area', () => {
  const shortlist = (
    spellId: string,
    slotLevel: number,
    placement?: { at?: Point; towards?: Point },
    log: readonly GameEvent[] = SETUP,
  ) => eligibleTargets(fold('seed', log), SRD_CONTENT, CASTER, spellId, slotLevel, placement);

  it('lists exactly the Sphere’s catch, the caster among them', () => {
    const out = shortlist('sleep', 1, { at: AT });
    expect(out.eligible.slice().sort()).toEqual([CASTER, HOBGOBLIN, SLEEPER].sort());
    expect(out.needsContext).toEqual([]);
  });

  /**
   * The property the whole change is for: every name the door offers is one
   * the casting accepts, and every name it withholds is one the casting
   * refuses.
   */
  it('agrees with the casting about every creature in the scene', () => {
    const out = shortlist('sleep', 1, { at: AT });
    const landed = unwrap(
      castOn(SETUP, { spellId: 'sleep', targets: out.eligible, at: AT, slotLevel: 1 }, FORCED),
      'sleep on the shortlist',
    );
    expect(caught(landed.outcomes)).toEqual(out.eligible.slice().sort());

    for (const key of Object.keys(fold('seed', SETUP).creatures)) {
      const who = id(key);
      if (out.eligible.includes(who)) continue;
      const refused = castOn(SETUP, { spellId: 'sleep', targets: [who], at: AT, slotLevel: 1 });
      expect(isErr(refused) && refused.code).toBe('not_in_the_area');
    }
  });

  /** And says why the others are off it, in the sentences the catch writes. */
  it('names everyone it left off, and the geometry for those outside', () => {
    const out = shortlist('sleep', 1, { at: AT });
    const off = Object.fromEntries(out.excluded.map((e) => [e.target, e.reason]));
    expect(Object.keys(off).sort()).toEqual([ALLY, GOBLIN, OUTSIDER].sort());
    expect(off[OUTSIDER]).toContain('area');
  });

  /**
   * Without a point there is no catch, and no list either. A `route` request
   * rather than a refusal or a guess: the caller re-sends the question with
   * the field filled in, which is exactly what `no_origin` tells `resolveSpell`
   * to do.
   */
  it('asks for the point rather than falling back on the Range', () => {
    const out = shortlist('sleep', 1);
    expect(out.eligible).toEqual([]);
    expect(out.needsContext.map((n) => n.kind)).toEqual(['route']);
    expect(out.needsContext[0]?.satisfyWith).toContain('at');
  });

  /** A directional template wants its direction on the same terms. */
  it('asks for the direction a Cube is pointed in', () => {
    const out = shortlist('entangle', 1, { at: AT });
    expect(out.eligible).toEqual([]);
    expect(out.needsContext.map((n) => n.kind)).toEqual(['route']);
  });

  /**
   * And the Range still bounds the *point*, which is the one thing it is for
   * once the template is doing the catching: a Sphere the caster cannot reach
   * is a placement to correct, not a list to hand back.
   */
  it('refuses a point beyond the spell’s Range, and says to move it', () => {
    const out = shortlist('sleep', 1, { at: AWAY });
    expect(out.eligible).toEqual([]);
    expect(out.needsContext.map((n) => n.kind)).toEqual(['route']);
    expect(out.needsContext[0]?.need).toContain('60 feet');
  });

  /** SRD Entangle's parenthesis reaches the shortlist as it reaches the catch. */
  it('leaves the caster out of their own plants, and says which clause did it', () => {
    const out = shortlist('entangle', 1, { at: AT, towards: TOWARDS });
    expect(out.eligible.slice().sort()).toEqual([ALLY, GOBLIN].sort());
    expect(out.excluded.find((e) => e.target === CASTER)?.reason).toContain('other than you');
  });

  /** And Hypnotic Pattern's sight clause, which is now the helper's answer. */
  it('leaves a blind creature off the pattern’s list', () => {
    const out = shortlist('hypnotic-pattern', 3, { at: AT, towards: TOWARDS }, [
      ...SETUP,
      { type: 'condition-applied', id: ALLY, condition: 'blinded', source: 'a faceful of sand' },
    ]);
    expect(out.eligible).not.toContain(ALLY);
    expect(out.excluded.find((e) => e.target === ALLY)?.reason).toContain('see');
  });

  /**
   * A spell that takes named targets is untouched: the shortlist is the
   * per-creature walk it always was, and a placement it never needed is
   * ignored rather than changing the answer.
   */
  it('leaves a named-target spell exactly as it was', () => {
    const plain = shortlist('hold-person', 2);
    // It asks about each creature's sight line one at a time, which is the
    // walk an area spell no longer makes.
    expect(plain.needsContext.map((n) => n.kind)).toContain('visibility');
    expect(shortlist('hold-person', 2, { at: AT })).toEqual(plain);
  });
});
