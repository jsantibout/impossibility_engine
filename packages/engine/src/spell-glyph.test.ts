import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { remaining, spellSlotKey } from './resources.js';
import {
  advanceTime,
  pendingCastingsOf,
  resolveDeclaredCast,
  resolveSpell,
  triggerGlyph,
} from './commands.js';

/**
 * SRD Glyph of Warding's **spell glyph** — a stored request, not a pending
 * casting.
 *
 * > "_Spell Glyph._ You can store a prepared spell of level 3 or lower in the
 * > glyph by casting it as part of creating the glyph. The spell must target a
 * > single creature or an area. The spell being stored has no immediate effect
 * > when cast in this way. When the glyph is triggered, the stored spell takes
 * > effect. If the spell has a target, it targets the creature that triggered
 * > the glyph. If the spell affects an area, the area is centered on that
 * > creature. … If the spell requires Concentration, it lasts until the end of
 * > its full duration." / _Using a Higher-Level Spell Slot._ "If you create a
 * > spell glyph, you can store any spell of up to the same level as the spell
 * > slot you use for the Glyph of Warding."
 *
 * The coordinator's ruling: a readied casting held without a deadline, with the
 * request stored on the glyph's record rather than in `pendingCastings` — where
 * it would be an open casting a Counterspell could answer on a rune in a
 * dungeon. The stored spell's own slot goes at the inscription beside the
 * glyph's; the DM's `trigger_glyph` names who set it off, and the stored spell
 * takes effect on them with nothing more spent and no Concentration held.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const CLERIC = id('cleric');
const BANDIT = id('bandit');
const BYSTANDER = id('bystander');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 12, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const THRESHOLD = { x: 100, y: 105, z: 0 };

const TEMPLE: readonly GameEvent[] = [
  added(CLERIC, 'party'),
  added(BANDIT, 'bandits'),
  added(BYSTANDER, 'bandits'),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'cleric',
      prepared: ['glyph-of-warding', 'hold-person', 'banishment', 'shatter', 'aid', 'animate-dead'],
    }),
  },
  ...[2, 3, 4].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CLERIC,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 2, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the door', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the door' }, feet: 0 } },
  // The bandit who will step on the rune, a hundred feet down the hall from
  // the cleric: nowhere near the Hold Person's sixty feet, and nobody has said
  // the cleric can see them. Neither matters — the stored spell targets
  // whoever triggered the glyph. A Humanoid, because a 2024 Goblin is Fey and
  // Hold Person names a Humanoid.
  { type: 'creature-placed', id: BANDIT, placement: { from: { landmark: 'the door' }, feet: 100, bearing: 0 } },
  { type: 'creature-placed', id: BYSTANDER, placement: { from: { landmark: 'the door' }, feet: 110, bearing: 0 } },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>, what: string): T => unwrap(result, what);

type Stored = { readonly spellId: string; readonly slotLevel: number };

/** An hour's inscription with a spell stored in it: declared, waited out, settled. */
const inscribed = (stores: Stored = { spellId: 'hold-person', slotLevel: 2 }, glyphSlot = 3) => {
  const declared = must(
    resolveSpell(
      fold('seed', TEMPLE),
      CLERIC,
      { spellId: 'glyph-of-warding', targets: [], at: THRESHOLD, slotLevel: glyphSlot, stores },
      supply('ink'),
    ),
    'declare',
  );
  let log: GameEvent[] = [...TEMPLE, ...declared.events];
  const castingId = pendingCastingsOf(fold('seed', log))[0]!.castingId;
  log = [...log, ...must(advanceTime(fold('seed', log), 3600, 'the hour'), 'hour')];
  const settled = must(resolveDeclaredCast(fold('seed', log), castingId, supply('settle')), 'settle');
  log = [...log, ...settled.events];
  return { log, castingId, settled, state: fold('seed', log) as GameState };
};

/** The fight the bandit walks into, begun after the rune was drawn. */
const inCombat = (log: readonly GameEvent[]): GameEvent[] => [
  ...log,
  {
    type: 'combat-started',
    combatants: [
      { id: BANDIT, initiative: 20, speed: 30 },
      { id: CLERIC, initiative: 10, speed: 30 },
      { id: BYSTANDER, initiative: 5, speed: 30 },
    ],
  },
];

const slots = (state: GameState, level: number): number =>
  remaining(state.creatures[CLERIC]!.resources, spellSlotKey(level));

describe('SRD Glyph of Warding’s spell glyph', () => {
  it('spends both slots at the inscription and stores the request on the record, with nothing pending', () => {
    const { state, castingId } = inscribed();
    expect(slots(state, 3)).toBe(1);
    expect(slots(state, 2)).toBe(1);
    expect(pendingCastingsOf(state)).toEqual([]);
    const record = state.ongoing[castingId]!;
    expect(record.stored).toMatchObject({ spellId: 'hold-person', slotLevel: 2 });
    // The explosive rune is the other option, and a glyph holding a spell does
    // not erupt with one as well.
    expect(record.triggered).toBeUndefined();
    // The stored spell has no immediate effect and holds no Concentration.
    expect(state.creatures[CLERIC]!.concentration).toBeNull();
    expect(state.creatures[BANDIT]!.conditions.conditions).toEqual([]);
  });

  it('asks the bandit the DM names for its Wisdom save, spends nothing more, holds no Concentration, and ends', () => {
    const { log, castingId } = inscribed();
    const fighting = inCombat(log);
    const before = fold('seed', fighting) as GameState;
    const fired = must(
      triggerGlyph(before, { castingId, by: BANDIT }, supply('step')),
      'trigger',
    );
    const after = fold('seed', [...fighting, ...fired.events]) as GameState;

    // The bandit, and only the bandit, rolled the stored spell's save.
    expect(fired.outcomes.map((one) => one.target)).toEqual([BANDIT]);
    expect(fired.outcomes[0]!.save).toBeDefined();
    // No slot, no action and no Concentration at the trigger.
    expect(slots(after, 2)).toBe(1);
    expect(slots(after, 3)).toBe(1);
    expect(fired.events.some((event) => event.type === 'action-spent')).toBe(false);
    expect(after.creatures[CLERIC]!.concentration).toBeNull();
    // And no casting was ever open between the inscription and the trigger, so
    // a Counterspell had nothing to answer.
    expect(pendingCastingsOf(before)).toEqual([]);
    expect(fired.events.some((event) => event.type === 'spell-declared')).toBe(false);
    // "Once a glyph is triggered, this spell ends."
    expect(after.ongoing[castingId]).toBeUndefined();
    expect(
      fired.events.some(
        (event) => event.type === 'spell-ended' && event.castingId === castingId && event.reason === 'triggered',
      ),
    ).toBe(true);
  });

  it('paralyses the bandit on a failure for the stored spell’s full minute, with no Concentration to break', () => {
    const { log, castingId } = inscribed();
    const fighting = inCombat(log);
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']) {
      const fired = must(
        triggerGlyph(fold('seed', fighting) as GameState, { castingId, by: BANDIT }, supply(seed)),
        'trigger',
      );
      if (fired.outcomes[0]?.save?.success !== false) continue;
      const after = fold('seed', [...fighting, ...fired.events]) as GameState;
      expect(after.creatures[BANDIT]!.conditions.conditions).toContain('paralyzed');
      expect(after.creatures[BYSTANDER]!.conditions.conditions).toEqual([]);
      const stored = Object.values(after.ongoing).find((one) => one.spellId === 'hold-person');
      expect(stored?.caster).toBe(CLERIC);
      expect(stored?.level).toBe(2);
      // The full duration, on the stored spell's own clock.
      expect(
        Object.values(after.timers).some(
          (timer) => timer.target.kind === 'casting' && timer.target.castingId === stored?.castingId,
        ),
      ).toBe(true);
      expect(after.creatures[CLERIC]!.concentration).toBeNull();
      return;
    }
    throw new Error('no seed makes the bandit fail');
  });

  it('centres a stored area on the creature that triggered it', () => {
    const { log, castingId } = inscribed({ spellId: 'shatter', slotLevel: 2 });
    const fired = must(
      triggerGlyph(fold('seed', log) as GameState, { castingId, by: BANDIT }, supply('boom')),
      'trigger',
    );
    // The bandit at the centre and the bystander ten feet away are both in the
    // 10-foot Sphere; the cleric, a hundred feet off, is not.
    expect(fired.outcomes.map((one) => one.target).sort()).toEqual([BYSTANDER, BANDIT].sort());
  });

  it('refuses a stored spell above the glyph’s own slot, before anything is spent', () => {
    const refused = resolveSpell(
      fold('seed', TEMPLE),
      CLERIC,
      {
        spellId: 'glyph-of-warding',
        targets: [],
        at: THRESHOLD,
        slotLevel: 3,
        stores: { spellId: 'banishment', slotLevel: 4 },
      },
      supply('ink'),
    );
    expect(isErr(refused) && refused.code).toBe('stored_level_too_high');
    const upcast = resolveSpell(
      fold('seed', TEMPLE),
      CLERIC,
      {
        spellId: 'glyph-of-warding',
        targets: [],
        at: THRESHOLD,
        slotLevel: 3,
        stores: { spellId: 'hold-person', slotLevel: 4 },
      },
      supply('ink'),
    );
    expect(isErr(upcast) && upcast.code).toBe('stored_level_too_high');
    // And a level 4 glyph holds the level 4 spell, as the higher-slot line says.
    const higher = resolveSpell(
      fold('seed', TEMPLE),
      CLERIC,
      {
        spellId: 'glyph-of-warding',
        targets: [],
        at: THRESHOLD,
        slotLevel: 4,
        stores: { spellId: 'banishment', slotLevel: 4 },
      },
      supply('ink'),
    );
    expect(higher.ok).toBe(true);
  });

  it('refuses a spell that is not prepared, and a spell that prints no glyph to store it in', () => {
    const unprepared = resolveSpell(
      fold('seed', TEMPLE),
      CLERIC,
      {
        spellId: 'glyph-of-warding',
        targets: [],
        at: THRESHOLD,
        slotLevel: 3,
        stores: { spellId: 'bless', slotLevel: 2 },
      },
      supply('ink'),
    );
    expect(isErr(unprepared) && unprepared.code).toBe('stored_not_prepared');
    const nowhere = resolveSpell(
      fold('seed', TEMPLE),
      CLERIC,
      { spellId: 'hold-person', targets: [BANDIT], slotLevel: 2, stores: { spellId: 'shatter', slotLevel: 2 } },
      supply('ink'),
    );
    expect(isErr(nowhere) && nowhere.code).toBe('stores_nothing');
  });

  it('refuses a spell that aims at neither one creature nor an area, and a rite of a minute', () => {
    // SRD Aid: "Choose up to three creatures" — not "a single creature".
    const three = resolveSpell(
      fold('seed', TEMPLE),
      CLERIC,
      { spellId: 'glyph-of-warding', targets: [], at: THRESHOLD, slotLevel: 3, stores: { spellId: 'aid', slotLevel: 2 } },
      supply('ink'),
    );
    expect(isErr(three) && three.code).toBe('stored_targets_nothing');
    // SRD Animate Dead takes a minute to cast, which the engine cannot hold
    // inside the glyph's own hour.
    const rite = resolveSpell(
      fold('seed', TEMPLE),
      CLERIC,
      {
        spellId: 'glyph-of-warding',
        targets: [],
        at: THRESHOLD,
        slotLevel: 3,
        stores: { spellId: 'animate-dead', slotLevel: 3 },
      },
      supply('ink'),
    );
    expect(isErr(rite) && rite.code).toBe('stored_spell_too_long');
  });

  it('asks the DM who set a spell glyph off, and refuses a triggerer for a rune that stores nothing', () => {
    const { log, castingId } = inscribed();
    const unnamed = triggerGlyph(fold('seed', log) as GameState, { castingId }, supply('step'));
    expect(isErr(unnamed) && unnamed.code).toBe('triggerer_required');

    const rune = must(
      resolveSpell(
        fold('seed', TEMPLE),
        CLERIC,
        { spellId: 'glyph-of-warding', targets: [], at: THRESHOLD, slotLevel: 3, damageType: 'fire' },
        supply('ink'),
      ),
      'declare the rune',
    );
    let runeLog: GameEvent[] = [...TEMPLE, ...rune.events];
    const runeId = pendingCastingsOf(fold('seed', runeLog))[0]!.castingId;
    runeLog = [...runeLog, ...must(advanceTime(fold('seed', runeLog), 3600, 'the hour'), 'hour')];
    runeLog = [...runeLog, ...must(resolveDeclaredCast(fold('seed', runeLog), runeId, supply('settle')), 'settle').events];
    const named = triggerGlyph(fold('seed', runeLog) as GameState, { castingId: runeId, by: BANDIT }, supply('step'));
    expect(isErr(named) && named.code).toBe('nothing_stored');
  });
});
