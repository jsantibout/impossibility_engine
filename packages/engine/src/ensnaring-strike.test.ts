import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { currentCombatant } from './combat.js';
import type { Rng, RngState } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { checkSpellDefinition } from './spell-schema.js';
import type { SpellDefinition, SpellEffect } from './spell-definitions.js';
import {
  applyConditionTo,
  availableChecks,
  resolveAttack,
  resolveAttackDamage,
  resolveEffectCheck,
  resolveTurn,
} from './commands.js';

/**
 * A strike that snares — SRD Ensnaring Strike.
 *
 * > _Level 1 Conjuration (Ranger)._ **Casting Time:** Bonus Action, which you
 * > take immediately after hitting a creature with a weapon. **Range:** Self.
 * > **Duration:** Concentration, up to 1 minute.
 * > "As you hit the target, grasping vines appear on it, and it makes a
 * > Strength saving throw. A Large or larger creature has Advantage on this
 * > save. On a failed save, the target has the Restrained condition until the
 * > spell ends. On a successful save, the vines shrivel away, and the spell
 * > ends. While Restrained, the target takes 1d6 Piercing damage at the start
 * > of each of its turns. The target or a creature within reach of it can take
 * > an action to make a Strength (Athletics) check against your spell save DC.
 * > On a success, the spell ends."
 * > _Using a Higher-Level Spell Slot._ "The damage increases by 1d6 for each
 * > spell slot level above 1."
 *
 * The fourth spell to print the smites' casting time and the first whose
 * payload is a **saving throw** rather than dice on the blow. It goes through
 * the same door Searing Smite does — settled on the hit that triggered it —
 * and what it hangs is the ordinary `save` effect aimed at the creature the
 * weapon just hit: a condition sourced to the casting, a payout of damage at
 * the target's own boundary, and an escape check anybody within reach may
 * attempt. Every number here is the engine's: the DC off the Ranger's sheet,
 * the mode off the target's size, the die at the boundary.
 */

const id = (s: string) => asCharacterId(s);
const SORREL = id('sorrel');
const GOBLIN = id('goblin');
const OGRE = id('ogre');
const FIGHTER = id('fighter');
const FAR = id('far');

const plain = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const ranger = (): CharacterChoices =>
  ({
    name: 'Sorrel',
    classId: 'ranger',
    level: 5,
    subclassId: 'hunter',
    speciesId: 'human',
    backgroundId: 'sage',
    abilities: {
      method: 'standard-array',
      assignment: { str: 12, dex: 15, con: 13, int: 8, wis: 14, cha: 10 },
    },
    abilityIncreases: { con: 2, wis: 1 },
    classSkills: ['survival', 'perception', 'stealth'],
    languages: ['Dwarvish', 'Orc'],
    alignment: 'Neutral',
    cantrips: [],
    spellbook: [],
    preparedSpells: [
      'hunters-mark',
      'cure-wounds',
      'goodberry',
      'ensnaring-strike',
      'fog-cloud',
      'pass-without-trace',
    ],
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: {
      'human:skillful': ['athletics'],
      'ranger:deft-explorer': ['survival'],
      'hunter:hunters-prey': ['Colossus Slayer'],
    },
    feats: {
      'sage:magic-initiate-wizard': {
        featId: 'magic-initiate',
        spellList: 'wizard',
        spellcastingAbility: 'int',
        cantrips: ['mage-hand', 'light'],
        levelOneSpell: 'find-familiar',
      },
      'human:versatile': { featId: 'alert' },
      'ranger:fighting-style': { featId: 'archery' },
      'ranger:ability-score-improvement': { featId: 'savage-attacker' },
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  }) as CharacterChoices;

const SETUP: readonly GameEvent[] = [
  ...(unwrap(createCharacter(SRD_CONTENT, ranger(), SORREL), 'create') as GameEvent[]),
  { type: 'creature-side-declared', id: SORREL, side: 'party' },
  {
    type: 'creature-added',
    id: GOBLIN,
    name: 'goblin',
    sheet: plain(),
    maxHp: 200,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'goblins',
    size: 'small',
  },
  {
    type: 'creature-added',
    id: OGRE,
    name: 'ogre',
    sheet: plain(),
    maxHp: 200,
    diesAtZero: false,
    creatureType: 'Giant',
    side: 'goblins',
    size: 'large',
  },
  {
    type: 'creature-added',
    id: FIGHTER,
    name: 'fighter',
    sheet: plain(),
    maxHp: 200,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'party',
  },
  {
    type: 'creature-added',
    id: FAR,
    name: 'far',
    sheet: plain(),
    maxHp: 200,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'party',
  },
  { type: 'items-gained', id: SORREL, items: [{ id: 'longsword', quantity: 1 }], source: 'loot' },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the gate', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: SORREL, placement: { from: { landmark: 'the gate' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: GOBLIN,
    placement: { from: { creature: SORREL }, feet: 5, bearing: 0 },
  },
  {
    type: 'creature-placed',
    id: OGRE,
    placement: { from: { creature: SORREL }, feet: 5, bearing: 180 },
  },
  {
    type: 'creature-placed',
    id: FIGHTER,
    placement: { from: { creature: GOBLIN }, feet: 5, bearing: 0 },
  },
  {
    type: 'creature-placed',
    id: FAR,
    placement: { from: { creature: GOBLIN }, feet: 30, bearing: 0 },
  },
  {
    type: 'combat-started',
    combatants: [
      { id: SORREL, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
      { id: OGRE, initiative: 8, speed: 40 },
      { id: FIGHTER, initiative: 5, speed: 30 },
      { id: FAR, initiative: 3, speed: 30 },
    ],
  },
];

/** A chosen face on every d20 and the maximum on everything else. */
const scripted = (d20: number): Rng => ({
  int: (sides: number) => (sides === 20 ? d20 : sides),
  snapshot: (): RngState => [0, 0, 0, 0],
});

const supply = (d20 = 10) => ({
  issuer: createRollIssuer('r'),
  rng: scripted(d20) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>): T => unwrap(result, 'the strike');

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

/** Swing at a creature with the damage held, then settle it with the strike. */
const snared = (
  target = GOBLIN,
  slotLevel = 1,
  d20 = 10,
  log: readonly GameEvent[] = SETUP,
): readonly GameEvent[] => {
  const hit = must(
    resolveAttack(
      state(log),
      SORREL,
      { target, weapon: 'longsword', hold: true },
      supply(d20),
    ),
  );
  const swung = [...log, ...hit.events];
  const settled = must(
    resolveAttackDamage(
      state(swung),
      SORREL,
      { smite: { spellId: 'ensnaring-strike', slotLevel } },
      supply(d20),
    ),
  );
  return [...swung, ...settled.events];
};

const castingOf = (log: readonly GameEvent[]): string => {
  const cast = log.find((event) => event.type === 'spell-cast' && event.spell === 'Ensnaring Strike');
  if (cast?.type !== 'spell-cast') throw new Error('no casting');
  return cast.castingId;
};

const restrained = (s: GameState, who = GOBLIN): boolean =>
  s.creatures[who]?.conditions.instances.some((one) => one.condition === 'restrained') === true;

/** Advance the order until it is this creature's turn, paying what each boundary owes. */
const untilTurnOf = (log: readonly GameEvent[], who: CharacterId): readonly GameEvent[] => {
  let current = log;
  for (let step = 0; step < 6; step += 1) {
    const combat = state(current).combat;
    if (combat !== null && currentCombatant(combat).id === who) return current;
    current = [...current, ...must(resolveTurn(state(current), supply())).events];
  }
  throw new Error(`${who} never got a turn`);
};

const saveRolled = (events: readonly GameEvent[], who = GOBLIN): GameEvent | undefined =>
  events.find(
    (event) =>
      event.type === 'roll-recorded' &&
      event.who === who &&
      event.label.includes('save vs Ensnaring Strike'),
  );

const vinesDealt = (events: readonly GameEvent[], who = GOBLIN): readonly number[] =>
  events.flatMap((event) =>
    event.type === 'damage-taken' && event.id === who && event.source?.includes('Ensnaring Strike')
      ? [event.amount]
      : [],
  );

describe('the definition is written to the book', () => {
  const strike = (): SpellDefinition =>
    SPELL_DEFINITIONS.find((one) => one.id === 'ensnaring-strike')!;

  it('is a save aimed at the creature the weapon just hit', () => {
    expect(strike().effects[0]).toMatchObject({
      kind: 'save',
      ability: 'str',
      onTheHit: true,
      saveModeIf: { sizeAtLeast: 'large', mode: 'advantage' },
      condition: 'restrained',
      endsCastingOnSuccess: true,
      check: {
        ability: 'str',
        skill: 'athletics',
        onSuccess: 'end-casting',
        byAnotherWithinReach: true,
      },
    });
  });

  it('hangs the vines’ die on the target’s own turn start, scaled by the slot', () => {
    const save = strike().effects[0] as Extract<SpellEffect, { kind: 'save' }>;
    expect(save.modifiers).toEqual([
      {
        kind: 'payout',
        at: 'start-of-turn',
        payout: 'damage',
        damage: { dice: '1d6', perSlotLevelAbove: '1d6' },
        damageType: 'piercing',
      },
    ]);
  });

  it('leaves nothing for the table to adjudicate', () => {
    expect(strike().unmodelled).toBeUndefined();
    expect(checkSpellDefinition(strike())).toEqual([]);
  });

  /**
   * Each rule the definition leans on refuses something, driven one at a
   * time — `spell-schema.test.ts`'s standing obligation, met here beside the
   * definition that made the rules necessary.
   */
  describe('the validator holds the strike to its shape', () => {
    const save = (): Extract<SpellEffect, { kind: 'save' }> =>
      strike().effects[0] as Extract<SpellEffect, { kind: 'save' }>;
    const codes = (
      over: Partial<SpellDefinition>,
      effect: Record<string, unknown> = save(),
    ): readonly string[] =>
      checkSpellDefinition({
        ...strike(),
        ...over,
        effects: [effect as unknown as SpellEffect],
      } as SpellDefinition).map((problem) => problem.code);

    it('refuses a size the engine does not rank, and a mode a save cannot take', () => {
      expect(
        codes({}, { ...save(), saveModeIf: { sizeAtLeast: 'colossal', mode: 'advantage' } }),
      ).toContain('bad_size');
      expect(codes({}, { ...save(), saveModeIf: { sizeAtLeast: 'large', mode: 'lucky' } })).toContain(
        'bad_mode',
      );
    });

    it('refuses the on-the-hit mark on a spell that names its own targets or takes an Action', () => {
      expect(codes({ targets: { count: 1 } })).toContain('on_the_hit_outside_a_smite');
      expect(codes({ castingTime: 'action' })).toContain('on_the_hit_outside_a_smite');
    });

    it('refuses a success that ends a casting no hit made, or that lasts no time', () => {
      const unhit: Record<string, unknown> = { ...save() };
      delete unhit['onTheHit'];
      expect(codes({}, unhit)).toContain('ends_casting_without_a_hit');
      const timeless: Record<string, unknown> = { ...strike() };
      delete timeless['durationSeconds'];
      expect(
        checkSpellDefinition(timeless as unknown as SpellDefinition).map((problem) => problem.code),
      ).toContain('ends_casting_without_a_duration');
    });

    it('refuses any value but true on the three marks', () => {
      expect(codes({}, { ...save(), onTheHit: false })).toContain('malformed_field');
      expect(codes({}, { ...save(), endsCastingOnSuccess: 'yes' })).toContain('malformed_field');
      expect(
        codes({}, { ...save(), check: { ...save().check, byAnotherWithinReach: false } }),
      ).toContain('malformed_field');
    });

    /**
     * A check that ends the casting needs a casting to end: `outlivesCasting`
     * files the condition under the spell's bare name, and the fold would meet
     * the success with nothing to release. Refused at authoring, and at the
     * command's door for a source with no casting in it — the twin of
     * `repeat_ends_no_casting` / `repeat_needs_a_casting`.
     */
    it('refuses a check ending the casting on a condition the casting has disowned', () => {
      expect(codes({}, { ...save(), outlivesCasting: true })).toContain('check_ends_no_casting');
      const refused = applyConditionTo(
        state(SETUP),
        GOBLIN,
        'restrained',
        'a tangle of rope',
        [],
        undefined,
        undefined,
        {},
        {
          ability: 'str',
          skill: 'athletics',
          dc: 12,
          onSuccess: 'end-casting',
          label: 'Strength (Athletics) check vs the rope',
        },
      );
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.code).toBe('check_needs_a_casting');
    });
  });
});

describe('the strike on the hit', () => {
  it('restrains a goblin that fails its Strength save, under the casting', () => {
    const log = snared();
    const after = state(log);
    const castingId = castingOf(log);

    expect(saveRolled(log)).toBeDefined();
    expect(restrained(after)).toBe(true);
    expect(after.ongoing[castingId]).toBeDefined();
    expect(after.creatures[SORREL]?.concentration?.castingId).toBe(castingId);
    // The condition is the casting's, so what ends the casting ends it.
    expect(
      after.creatures[GOBLIN]?.conditions.instances.find((one) => one.condition === 'restrained')?.source,
    ).toContain(castingId);
  });

  it('gives a Large creature Advantage on the save, read off its size', () => {
    const log = snared(OGRE);
    const rolled = saveRolled(log, OGRE);
    expect(rolled?.type).toBe('roll-recorded');
    if (rolled?.type !== 'roll-recorded') return;
    expect(rolled.modes?.some((mode) => mode.mode === 'advantage' && /Large/.test(mode.source))).toBe(true);

    // And the goblin, Small, gets no such thing.
    const small = saveRolled(snared());
    if (small?.type !== 'roll-recorded') throw new Error('no save');
    expect(small.modes ?? []).toEqual([]);
  });

  it('ends the spell when the target succeeds: the vines shrivel away', () => {
    const log = snared(GOBLIN, 1, 15);
    const after = state(log);
    const castingId = castingOf(log);
    expect(restrained(after)).toBe(false);
    expect(after.ongoing[castingId]).toBeUndefined();
    expect(after.creatures[SORREL]?.concentration).toBeNull();
    expect(
      log.some((event) => event.type === 'spell-ended' && event.castingId === castingId),
    ).toBe(true);
  });

  it('deals 1d6 Piercing at the start of the goblin’s turn, and 2d6 at a level 2 slot', () => {
    const log = snared();
    const next = must(resolveTurn(state(log), supply())).events;
    expect(vinesDealt(next)).toEqual([6]);
    expect(restrained(state([...log, ...next]))).toBe(true);

    const upcast = snared(GOBLIN, 2);
    expect(vinesDealt(must(resolveTurn(state(upcast), supply())).events)).toEqual([12]);
  });
});

describe('the escape', () => {
  it('offers the Athletics check to the target and to a creature within reach, not to one thirty feet off', () => {
    const after = state(snared());
    const mine = availableChecks(after, GOBLIN);
    const beside = availableChecks(after, FIGHTER);
    const away = availableChecks(after, FAR);
    expect(mine).toHaveLength(1);
    expect(beside).toHaveLength(1);
    expect(away).toHaveLength(0);
    expect(beside[0]).toMatchObject({
      by: FIGHTER,
      ability: 'str',
      skill: 'athletics',
      onSuccess: 'end-casting',
      effectKey: mine[0]!.effectKey,
    });
    // The DC is the Ranger's own spell save DC — 8 + 3 (proficiency) + 2
    // (Wisdom 15) — off the sheet and never stated.
    expect(beside[0]!.dc).toBe(13);
  });

  it('lets the fighter beside the goblin tear it free on a success, which ends the spell', () => {
    const log = untilTurnOf(snared(), FIGHTER);
    const before = state(log);
    const castingId = castingOf(log);
    const check = availableChecks(before, FIGHTER)[0]!;

    const freed = must(resolveEffectCheck(before, FIGHTER, { effectKey: check.effectKey }, supply(20)));
    expect(freed.success).toBe(true);
    expect(freed.onSuccess).toBe('end-casting');
    const after = state([...log, ...freed.events]);
    expect(restrained(after)).toBe(false);
    expect(after.ongoing[castingId]).toBeUndefined();
    expect(after.creatures[SORREL]?.concentration).toBeNull();
    // Nothing is paid at the goblin's next boundary either.
    expect(vinesDealt(must(resolveTurn(after, supply())).events)).toEqual([]);
  });

  it('leaves the vines standing on a failure', () => {
    const log = untilTurnOf(snared(), FIGHTER);
    const before = state(log);
    const check = availableChecks(before, FIGHTER)[0]!;
    const held = must(resolveEffectCheck(before, FIGHTER, { effectKey: check.effectKey }, supply(1)));
    expect(held.success).toBe(false);
    expect(restrained(state([...log, ...held.events]))).toBe(true);
  });

  it('refuses a creature that cannot reach the target', () => {
    const before = state(untilTurnOf(snared(), FAR));
    const check = availableChecks(before, GOBLIN)[0]!;
    const refused = resolveEffectCheck(before, FAR, { effectKey: check.effectKey }, supply(20));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('not_yours_to_attempt');
  });
});
