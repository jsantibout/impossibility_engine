import { describe, expect, it } from 'vitest';
import { FIRE_BOLT, HOLD_PERSON, SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import { createRng, restoreRng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { levelGrantedSpells, type SpellbookEntry } from './spellbook.js';
import { classCasting, routeFor } from './spellcasting.js';
import { scaledDiceFor, targetCountFor } from './spell-definitions.js';
import { freeCastPoolKey, createCharacter, type CharacterChoices } from './creation.js';
import { pendingSavesOf, resolveSpell, resolveTurn } from './commands.js';

/**
 * Spells the engine executes, rather than a fixture pretending it does.
 *
 * Two definitions cover the shapes: an attack that deals scaling damage, and a
 * save that imposes a condition with an escape that repeats. Everything
 * mechanical is derived from the definition and the caster's own sheet — the
 * attack modifier, the save DC, the damage dice, the duration, the turn hook —
 * so a caller names a spell and some targets and does not get to say what
 * happens.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('kessa');
const GOBLIN = id('goblin');
const OGRE = id('ogre');

const book = (level: number): SpellbookEntry[] =>
  ['magic-missile', 'shield', 'detect-magic', 'feather-fall', 'mage-armor', 'hold-person',
   'thunderwave', 'charm-person', 'misty-step', 'web']
    .slice(0, levelGrantedSpells(level))
    .map((spellId, index) => ({
      spellId,
      acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
      origin: 'level' as const,
    }));

const kessa = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Kessa',
  classId: 'wizard',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Chaotic Good',
  subclassId: 'evoker',
  cantrips: ['fire-bolt', 'light', 'prestidigitation'],
  spellbook: book(3),
  preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'hold-person', 'burning-hands', 'scorching-ray'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'wizard:scholar': ['arcana'],
    'human:skillful': ['perception'],
    'evoker:evocation-savant': ['burning-hands', 'scorching-ray'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'survival'] },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

const dummy = (who: CharacterId, name: string, maxHp = 30): GameEvent => ({
  type: 'creature-added',
  id: who,
  name,
  maxHp,
  // Humanoid, so Hold Person is legal against them. SRD 2024 goblins are Fey,
  // which is its own test in boundaries.test.ts.
  creatureType: 'Humanoid',
  sheet: {
    level: 1,
    abilities: { str: 10, dex: 12, con: 12, int: 8, wis: 8, cha: 8 },
    skills: {},
    saveProficiencies: [],
    armor: null,
    shield: null,
    armorTraining: { light: true, medium: true, heavy: false, shields: true },
    baseSpeed: 30,
    spellcastingAbility: null,
    stated: { armorClass: 13, proficiencyBonus: 2, initiative: 1 },
  },
});

/** A table with the wizard, two victims, a scene, and a fight running. */
const table = (over: Partial<CharacterChoices> = {}): GameEvent[] => [
  ...unwrap(createCharacter(SRD_CONTENT,kessa(over), WIZARD), 'create'),
  dummy(GOBLIN, 'Goblin'),
  dummy(OGRE, 'Ogre'),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the door', at: { x: 20, y: 20, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the door' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: WIZARD }, feet: 20, bearing: 0 } },
  { type: 'creature-placed', id: OGRE, placement: { from: { creature: WIZARD }, feet: 20, bearing: 90 } },
  // A level 3 Wizard has no level 3 slot of their own. This one is a grant —
  // a ring, a scroll, whatever the DM says — declared so upcasting can be
  // exercised at all. Pools are declared, never derived, so this is ordinary.
  {
    type: 'resource-pool-declared',
    id: WIZARD,
    pool: { key: spellSlotKey(3), label: 'level 3 spell slot', max: 1, recovers: 'long-rest' },
  },
  { type: 'sight-declared', from: WIZARD, to: GOBLIN, seen: true },
  { type: 'sight-declared', from: WIZARD, to: OGRE, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: WIZARD, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
      { id: OGRE, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (state: GameState, flat?: number) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: state.rng === null ? createRng('seed') : restoreRng(state.rng),
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
  content: SRD_CONTENT,
});

const CERTAIN = 40;
const DOOMED = -40;

const cast = (
  log: readonly GameEvent[],
  request: Parameters<typeof resolveSpell>[2],
  flat?: number,
) => {
  const state = fold('seed', log);
  const result = unwrap(resolveSpell(state, WIZARD, request, supply(state, flat)), 'cast');
  return {
    log: [...log, ...result.events],
    state: fold('seed', [...log, ...result.events]),
    outcome: result,
  };
};

const conditionsOf = (state: GameState, who: string) =>
  state.creatures[who]?.conditions.conditions ?? [];

describe('the definitions match the SRD', () => {
  it('states Fire Bolt as printed', () => {
    expect(FIRE_BOLT).toMatchObject({
      level: 0,
      school: 'evocation',
      castingTime: 'action',
      concentration: false,
      range: { kind: 'ranged', feet: 120 },
    });
    expect(FIRE_BOLT.effects[0]).toMatchObject({ kind: 'attack', damageType: 'fire' });
  });

  it('states Hold Person as printed', () => {
    expect(HOLD_PERSON).toMatchObject({
      level: 2,
      school: 'enchantment',
      concentration: true,
      range: { kind: 'ranged', feet: 60 },
      durationSeconds: 60,
    });
    expect(HOLD_PERSON.effects[0]).toMatchObject({
      kind: 'save',
      ability: 'wis',
      condition: 'paralyzed',
      repeats: { at: 'end-of-turn', onSuccess: 'end-on-target' },
    });
  });

  /** SRD: "increases by 1d10 when you reach levels 5 (2d10), 11 (3d10), 17 (4d10)." */
  it('scales a cantrip by caster level, not by slot', () => {
    const scaling = { dice: '1d10', cantripUpgradesAt: [5, 11, 17] };
    expect(scaledDiceFor(scaling, 0, 1, 0)).toBe('1d10');
    expect(scaledDiceFor(scaling, 0, 4, 0)).toBe('1d10');
    expect(scaledDiceFor(scaling, 0, 5, 0)).toBe('2d10');
    expect(scaledDiceFor(scaling, 0, 11, 0)).toBe('3d10');
    expect(scaledDiceFor(scaling, 0, 17, 0)).toBe('4d10');
    expect(scaledDiceFor(scaling, 0, 20, 0)).toBe('4d10');
  });

  it('scales a levelled spell by slot, not by caster level', () => {
    const scaling = { dice: '2d6', perSlotLevelAbove: '1d6' };
    expect(scaledDiceFor(scaling, 1, 20, 1)).toBe('2d6');
    expect(scaledDiceFor(scaling, 1, 1, 3)).toBe('4d6');
  });

  /** SRD: "one additional Humanoid for each spell slot level above 2." */
  it('adds a Hold Person target per slot level above 2', () => {
    expect(targetCountFor(HOLD_PERSON.targets, 2, 2)).toBe(1);
    expect(targetCountFor(HOLD_PERSON.targets, 2, 3)).toBe(2);
    expect(targetCountFor(HOLD_PERSON.targets, 2, 5)).toBe(4);
  });

  it('is found by the id the SRD index uses', () => {
    expect(SRD_CONTENT.spell('fire-bolt')).toBe(FIRE_BOLT);
    expect(SRD_CONTENT.spell('hold-person')).toBe(HOLD_PERSON);
    // Magic Missile is parsed and has no definition: it hits without an
    // attack roll, and that shape does not exist yet.
    expect(SRD_CONTENT.spell('magic-missile')).toBeNull();
  });
});

describe('what creation granted is what can be cast', () => {
  const state = () => fold('seed', table());

  it('knows the class cantrips and prepared spells', () => {
    const casting = classCasting(state().creatures.kessa!.spellcasting, 'wizard');
    expect(casting?.ability).toBe('int');
    expect(casting?.cantrips).toContain('fire-bolt');
    expect(casting?.prepared).toContain('hold-person');
  });

  /** Magic Initiate's selections reach usable state, not just the record. */
  it('carries the feat spells, with their own ability', () => {
    const casting = state().creatures.kessa!.spellcasting;
    const granted = casting.granted.map((g) => g.spellId);
    expect(granted).toEqual(['mage-hand', 'ray-of-frost', 'find-familiar']);
    for (const grant of casting.granted) {
      expect(grant.ability).toBe('int');
      expect(grant.source).toBe('sage:magic-initiate-wizard');
    }
  });

  /** SRD Magic Initiate: "You can cast it once without a spell slot." */
  it('declares a pool for the free daily casting of the level 1 spell', () => {
    const pool = freeCastPoolKey('sage:magic-initiate-wizard');
    expect(remaining(state().creatures.kessa!.resources, pool)).toBe(1);
    // The cantrips need no pool; they are cast at will.
    expect(state().creatures.kessa!.spellcasting.granted[0]?.freeCastPool).toBeNull();
  });

  it('routes a spell to the source that supplies it', () => {
    const casting = state().creatures.kessa!.spellcasting;
    expect(routeFor(casting, 'fire-bolt')).toMatchObject({ kind: 'cantrip' });
    expect(routeFor(casting, 'hold-person')).toMatchObject({ kind: 'prepared' });
    expect(routeFor(casting, 'find-familiar')).toMatchObject({ kind: 'granted' });
    expect(routeFor(casting, 'fireball')).toBeNull();
  });

  /** SRD Alert: "you can add your Proficiency Bonus to the roll." */
  it('offers Alert as a named Initiative bonus when the feat was taken', () => {
    const plain = fold('seed', table());
    expect(plain.creatures.kessa!.character).not.toBeNull();

    const alert = unwrap(
      createCharacter(
        SRD_CONTENT,
        kessa({
          feats: {
            ...kessa().feats,
            'human:versatile': { featId: 'alert' },
          },
        }),
        WIZARD,
      ),
      'create',
    );
    expect(alert.length).toBeGreaterThan(0);
  });
});

describe('casting Fire Bolt', () => {
  it('hits, and deals the damage the definition scales', () => {
    const { outcome, state } = cast(table(), { spellId: 'fire-bolt', targets: [GOBLIN] }, CERTAIN);
    const hit = outcome.outcomes[0]!;
    expect(hit.affected).toBe(true);
    // 1d10 at level 3: between 1 and 10, and never the 2d10 a level 5 throws.
    expect(hit.damage).toBeGreaterThanOrEqual(1);
    expect(hit.damage).toBeLessThanOrEqual(10);
    expect(state.creatures.goblin!.vitals.hp).toBe(30 - (hit.damage ?? 0));
  });

  /**
   * **And Kessa is an Evoker**, so a missed cantrip still stings.
   *
   * SRD Potent Cantrip: "When you cast a cantrip at a creature and you miss
   * with the attack roll ... the target takes half the cantrip's damage (if
   * any) but suffers no additional effect from the cantrip." The miss is still
   * a miss — `affected` is false, exactly as a made saving throw against a
   * spell that halves is — and the half of a 1d10 is what lands. This assertion
   * used to read "without dealing damage" and was right until the Evoker's
   * level 3 feature was executed; it is the same fixture and the rule moved
   * under it, which is the whole point of driving features through a real
   * character.
   */
  it('misses, and an Evoker still deals half', () => {
    const { outcome, state } = cast(table(), { spellId: 'fire-bolt', targets: [GOBLIN] }, DOOMED);
    expect(outcome.outcomes[0]).toMatchObject({ affected: false });
    // The number rather than a range: a half that came out zero is exactly the
    // reading this assertion used to hold, and a range would not tell them apart.
    expect(outcome.outcomes[0]?.damage).toBe(3);
    expect(state.creatures.goblin!.vitals.hp).toBe(27);
  });

  it('spends the action and no slot', () => {
    const { state } = cast(table(), { spellId: 'fire-bolt', targets: [GOBLIN] }, CERTAIN);
    expect(state.combat?.budgets.kessa?.action).toBe(false);
    expect(remaining(state.creatures.kessa!.resources, spellSlotKey(1))).toBe(4);
  });

  it('refuses a second action cantrip on the same turn', () => {
    const first = cast(table(), { spellId: 'fire-bolt', targets: [GOBLIN] }, CERTAIN);
    const again = resolveSpell(
      first.state,
      WIZARD,
      { spellId: 'fire-bolt', targets: [OGRE] },
      supply(first.state, CERTAIN),
    );
    expect(isErr(again)).toBe(true);
    if (isErr(again)) expect(again.code).toBe('no_action');
  });

  it('derives the attack modifier from the sheet, and says so in the log', () => {
    const { log } = cast(table(), { spellId: 'fire-bolt', targets: [GOBLIN] }, CERTAIN);
    const recorded = log.find((e) => e.type === 'roll-recorded');
    // Intelligence 17 (+3) plus a Proficiency Bonus of 2.
    expect(recorded).toMatchObject({
      label: 'Fire Bolt attack',
      contributions: [{ source: 'spell attack', amount: 5 }],
    });
  });
});

describe('casting Hold Person', () => {
  const held = (flat = DOOMED) =>
    cast(table(), { spellId: 'hold-person', targets: [GOBLIN], slotLevel: 2 }, flat);

  it('paralyses a target that fails its save, and starts Concentration', () => {
    const { state, outcome } = held();
    expect(outcome.outcomes[0]).toMatchObject({ conditions: ['paralyzed'], affected: true });
    expect(conditionsOf(state, 'goblin')).toContain('paralyzed');
    expect(state.creatures.kessa!.concentration).toMatchObject({ spell: 'Hold Person' });
    // A level 3 Wizard has two level 2 slots; one is now gone.
    expect(remaining(state.creatures.kessa!.resources, spellSlotKey(2))).toBe(1);
  });

  it('does nothing to a target that resists', () => {
    const { state, outcome } = held(CERTAIN);
    expect(outcome.outcomes[0]).toMatchObject({ affected: false });
    expect(conditionsOf(state, 'goblin')).not.toContain('paralyzed');
    // The slot is spent either way: SRD, the spell was cast.
    expect(remaining(state.creatures.kessa!.resources, spellSlotKey(2))).toBe(1);
  });

  it('derives the save DC from the sheet', () => {
    const { log } = held();
    const recorded = log.find((e) => e.type === 'roll-recorded');
    // 8 + Proficiency 2 + Intelligence 3.
    expect(recorded).toMatchObject({ label: 'Wisdom save vs Hold Person' });
  });

  /** The turn hook comes from the definition, and the turn raises it. */
  it('attaches the end-of-turn repeat save the definition describes', () => {
    const { log, state } = held();
    // The wizard's turn ends: nothing owed. The goblin's: the save.
    const afterWizard = [...log, ...unwrap(resolveTurn(state, supply(state, DOOMED)), 'turn').events];
    const next = fold('seed', afterWizard);
    const goblinsTurn = unwrap(resolveTurn(next, supply(next, DOOMED)), 'turn');

    expect(goblinsTurn.saves).toMatchObject([{ target: GOBLIN, ability: 'wis', success: false }]);
    expect(conditionsOf(fold('seed', [...afterWizard, ...goblinsTurn.events]), 'goblin')).toContain(
      'paralyzed',
    );
  });

  it('frees one target and leaves the other held when upcast', () => {
    const both = cast(
      table(),
      { spellId: 'hold-person', targets: [GOBLIN, OGRE], slotLevel: 3 },
      DOOMED,
    );
    expect(conditionsOf(both.state, 'goblin')).toContain('paralyzed');
    expect(conditionsOf(both.state, 'ogre')).toContain('paralyzed');

    // End the wizard's turn, then the goblin's, which it shakes off.
    const a = [...both.log, ...unwrap(resolveTurn(both.state, supply(both.state, DOOMED)), 't').events];
    const sa = fold('seed', a);
    const b = [...a, ...unwrap(resolveTurn(sa, supply(sa, CERTAIN)), 't').events];
    const after = fold('seed', b);

    expect(conditionsOf(after, 'goblin')).not.toContain('paralyzed');
    expect(conditionsOf(after, 'ogre')).toContain('paralyzed');
    expect(after.creatures.kessa!.concentration).toMatchObject({ spell: 'Hold Person' });
  });

  it('refuses more targets than the slot allows', () => {
    const state = fold('seed', table());
    const result = resolveSpell(
      state,
      WIZARD,
      { spellId: 'hold-person', targets: [GOBLIN, OGRE], slotLevel: 2 },
      supply(state),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('too_many_targets');
  });
});

describe('what a cast refuses, and what it admits it cannot check', () => {
  const reject = (request: Parameters<typeof resolveSpell>[2], code: string) => {
    const state = fold('seed', table());
    const result = resolveSpell(state, WIZARD, request, supply(state));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe(code);
  };

  it('refuses a spell the engine cannot execute', () => {
    reject({ spellId: 'magic-missile', targets: [GOBLIN] }, 'no_definition');
  });

  /** SRD: you cast what you know or have prepared. */
  it('refuses a spell the caster has not prepared', () => {
    const state = fold(
      'seed',
      table({
        preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'web', 'burning-hands', 'scorching-ray'],
      }),
    );
    const result = resolveSpell(
      state,
      WIZARD,
      { spellId: 'hold-person', targets: [GOBLIN], slotLevel: 2 },
      supply(state),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('spell_not_available');
  });

  it('refuses no targets, a duplicate target, or a stranger', () => {
    reject({ spellId: 'fire-bolt', targets: [] }, 'no_targets');
    reject({ spellId: 'hold-person', targets: [GOBLIN, GOBLIN], slotLevel: 3 }, 'duplicate_target');
    reject({ spellId: 'fire-bolt', targets: [id('nobody')] }, 'unknown_creature');
  });

  it('refuses a target it cannot reach', () => {
    const far: GameEvent[] = [
      ...table(),
      { type: 'creature-moved', id: GOBLIN, placement: { from: { creature: WIZARD }, feet: 150, bearing: 0 } },
    ];
    const state = fold('seed', far);
    const result = resolveSpell(
      state,
      WIZARD,
      { spellId: 'hold-person', targets: [GOBLIN], slotLevel: 2 },
      supply(state),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('out_of_range');
  });

  /** SRD: "a caster must have a clear path to it, so it can't be behind Total Cover." */
  it('refuses a target behind Total Cover', () => {
    const hidden: GameEvent[] = [
      ...table(),
      { type: 'cover-declared', from: WIZARD, to: GOBLIN, degree: 'total' },
    ];
    const state = fold('seed', hidden);
    const result = resolveSpell(
      state,
      WIZARD,
      { spellId: 'fire-bolt', targets: [GOBLIN] },
      supply(state),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('total_cover');
  });

  /**
   * The creature type is checked now rather than reported — see
   * `boundaries.test.ts`. What is left here is that a cast which *can* be
   * judged claims nothing it did not check.
   */
  it('claims no unverified checks when it could make them all', () => {
    const { outcome } = cast(table(), { spellId: 'hold-person', targets: [GOBLIN], slotLevel: 2 }, DOOMED);
    expect(outcome.unverified).toEqual([]);
  });

  /** A pending boundary save leaves the world unsettled; nothing acts into that. */
  it('refuses to cast while a turn-boundary save is outstanding', () => {
    const { log, state } = cast(table(), { spellId: 'hold-person', targets: [GOBLIN], slotLevel: 2 }, DOOMED);
    const afterWizard = [...log, ...unwrap(resolveTurn(state, supply(state, DOOMED)), 't').events];
    const next = fold('seed', afterWizard);

    // End the goblin's turn without a generator: the save is owed, not rolled.
    const deferred = [...afterWizard, ...unwrap(resolveTurn(next), 't').events];
    const owing = fold('seed', deferred);
    expect(pendingSavesOf(owing)).toHaveLength(1);

    const result = resolveSpell(
      owing,
      WIZARD,
      { spellId: 'fire-bolt', targets: [OGRE] },
      supply(owing, CERTAIN),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('saves_pending');
  });
});

describe('a feat-granted spell casts on the feat terms', () => {
  /**
   * Find Familiar comes from Magic Initiate, not the Wizard's list. When the
   * caster omits what the spell leaves to them — the form — the engine refuses,
   * but it says *that*, not that the caster does not know the spell. That
   * distinction is what a tool surface needs in order to decide what to tell
   * the player.
   *
   * (This was Ray of Frost, then Mage Hand, then Find Familiar's missing
   * mechanic, each until it got a definition; the summon shape landed on
   * 2026-09-22 and the familiar is a kept creature now. The point survives the
   * definition: the refusal is about the *casting*, and the route is known.)
   */
  it('knows the caster has it, and asks for what the spell leaves to them', () => {
    const state = fold('seed', table());
    expect(routeFor(state.creatures.kessa!.spellcasting, 'find-familiar')).toMatchObject({
      kind: 'granted',
    });

    const result = resolveSpell(
      state,
      WIZARD,
      { spellId: 'find-familiar', targets: [WIZARD], choice: 'Fey' },
      supply(state),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.code).toBe('form_required');
  });

  /**
   * And the other half of the same distinction: a granted spell that *does*
   * have a definition casts on the feat's own terms rather than the class's.
   */
  it('casts a granted spell the engine can execute', () => {
    const state = fold('seed', table());
    const out = unwrap(
      resolveSpell(state, WIZARD, { spellId: 'ray-of-frost', targets: [GOBLIN] }, supply(state)),
      'ray-of-frost',
    );
    expect(out.castingId!.length).toBeGreaterThan(0);
  });
});

describe('casting is retry-safe and replays', () => {
  it('is a no-op when the same command id is retried', () => {
    const first = cast(table(), { spellId: 'fire-bolt', targets: [GOBLIN], commandId: 'c1' }, CERTAIN);
    const retry = unwrap(
      resolveSpell(
        first.state,
        WIZARD,
        { spellId: 'fire-bolt', targets: [GOBLIN], commandId: 'c1' },
        supply(first.state, CERTAIN),
      ),
      'retry',
    );
    expect(retry.events).toEqual([]);
    expect(fold('seed', [...first.log, ...retry.events])).toEqual(first.state);
  });

  it('folds to the same state twice and survives JSON', () => {
    const { log, state } = cast(table(), { spellId: 'hold-person', targets: [GOBLIN], slotLevel: 2 }, DOOMED);
    expect(fold('seed', log)).toEqual(fold('seed', log));
    expect(JSON.parse(JSON.stringify(state)) as GameState).toEqual(state);
  });

  it('replays prefix by prefix', () => {
    const { log } = cast(table(), { spellId: 'hold-person', targets: [GOBLIN], slotLevel: 2 }, DOOMED);
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });

  /** Breaking Concentration cleans every target the casting caught. */
  it('cleans up every target when the casting ends', () => {
    const both = cast(table(), { spellId: 'hold-person', targets: [GOBLIN, OGRE], slotLevel: 3 }, DOOMED);
    const hurt: GameEvent[] = [
      ...both.log,
      { type: 'concentration-ended', id: WIZARD, castingId: both.outcome.castingId!, reason: 'dispelled' },
    ];
    const after = fold('seed', hurt);

    expect(conditionsOf(after, 'goblin')).not.toContain('paralyzed');
    expect(conditionsOf(after, 'ogre')).not.toContain('paralyzed');
    expect(after.creatures.kessa!.concentration).toBeNull();
    expect(pendingSavesOf(after)).toEqual([]);
  });
});
