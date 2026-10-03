import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import type { Rng, RngState } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { extendContent } from './content.js';
import type { SpellDefinition } from './spell-definitions.js';
import { spellSlotKey, remaining } from './resources.js';
import {
  advanceTime,
  pendingCastingsOf,
  resolveAttack,
  resolveAttackDamage,
  resolveDeclaredCast,
  resolveSpell,
  takeReady,
} from './commands.js';

/**
 * SRD Slow: "If it casts a spell with a Somatic component, there is a 25
 * percent chance the spell fails as a result of the target making the spell's
 * gestures too slowly."
 *
 * `slow-somatic.test.ts` throws the die where a casting goes through the
 * casting pipeline. **Three roads made a casting somewhere else**, and a
 * slowed caster's spell on any of them never failed:
 *
 * | Road | Where the casting is made | What failing costs |
 * |---|---|---|
 * | the Ready | `takeReady`, where the slot is spent and the energy held | the action and the slot; nothing is held |
 * | a cantrip cast with the swing | `resolveAttack`, SRD True Strike | the Action; no attack is made |
 * | a spell cast on a hit | `resolveAttackDamage` | the Bonus Action and the slot; the weapon's own blow still lands |
 * | a spell a glyph stores | the glyph's settlement, "as part of creating the glyph" | the stored spell's slot; the glyph holds nothing |
 *
 * Each throws the same die through the same `castingFailure`, after the cost
 * is paid and before a die of the spell's own.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WIZARD = id('wizard');
const GOBLIN = id('goblin');

/**
 * Faces in the order given, then every die on its highest face. A d100 at or
 * under 25 fails the casting and one above holds it, so the branch is chosen
 * rather than sampled.
 */
const faces = (...given: readonly number[]): Rng => {
  let thrown = 0;
  return {
    int: (sides: number) => given[thrown++] ?? sides,
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 12, int: 18, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 400,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

/** The rule Slow's failed save hangs, stood on the wizard by hand. */
const SLOWED: GameEvent = {
  type: 'action-rule-granted',
  id: WIZARD,
  rule: {
    source: 'Slow#cast:90',
    rule: { kind: 'casting-chance', component: 'somatic', percent: 25 },
    label: 'Slow',
    until: 'the spell ends',
  },
};

/**
 * A homebrew smite whose casting has gestures: every SRD spell cast on a hit
 * prints a Verbal component and nothing else, so this road has no SRD writer
 * and a homebrew one reaches it. No entry, which reads as Verbal and Somatic.
 */
const GESTURE_SMITE: SpellDefinition = {
  ...SRD_CONTENT.spell('searing-smite')!,
  id: 'gesture-smite',
  name: 'Gesture Smite',
};
const CONTENT = unwrap(extendContent(SRD_CONTENT, { spells: [GESTURE_SMITE] }), 'content');

const FIELD: readonly GameEvent[] = [
  added(WIZARD, 'party'),
  added(GOBLIN, 'foes'),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      cantrips: ['fire-bolt', 'true-strike'],
      prepared: ['magic-missile', 'gesture-smite', 'glyph-of-warding', 'hold-person'],
    }),
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WIZARD,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  { type: 'items-gained', id: WIZARD, items: [{ id: 'longsword', quantity: 1 }], source: 'kit' },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the door', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the door' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: WIZARD }, feet: 5, bearing: 0 } },
  { type: 'sight-declared', from: WIZARD, to: GOBLIN, seen: true },
  { type: 'sight-declared', from: GOBLIN, to: WIZARD, seen: true },
];

const FIGHT: readonly GameEvent[] = [
  ...FIELD,
  {
    type: 'combat-started',
    combatants: [
      { id: WIZARD, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
    ],
  },
  SLOWED,
];

const supply = (state: GameState, rng: Rng) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng,
  content: CONTENT,
});

/** The die the rule throws, told apart from every die of the spell's own. */
const fumbles = (events: readonly GameEvent[]) =>
  events.filter(
    (event): event is Extract<GameEvent, { type: 'roll-recorded' }> =>
      event.type === 'roll-recorded' && event.label.includes('under Slow'),
  );
const fizzled = (events: readonly GameEvent[]) =>
  events.filter((event) => event.type === 'spell-fizzled');

describe('the Ready: the casting is made when the spell is readied', () => {
  const ready = (rng: Rng) => {
    const state = fold('slow', FIGHT);
    return unwrap(
      takeReady(
        state,
        WIZARD,
        {
          trigger: 'when the goblin moves',
          response: { kind: 'spell', spellId: 'magic-missile', slotLevel: 1 },
        },
        CONTENT,
        { issuer: createRollIssuer('r', state.rollsIssued), rng },
      ),
      'ready',
    );
  };

  it('throws the die at the Ready, and a failure spends the action and the slot and holds nothing', () => {
    const events = ready(faces(10));
    expect(fumbles(events)).toHaveLength(1);
    expect(fizzled(events)).toHaveLength(1);
    const after = fold('slow', [...FIGHT, ...events]);
    expect(after.creatures[WIZARD]!.readied).toBeNull();
    expect(after.creatures[WIZARD]!.concentration).toBeNull();
    expect(after.combat?.budgets[WIZARD]?.action).toBe(false);
    expect(remaining(after.creatures[WIZARD]!.resources, spellSlotKey(1))).toBe(3);
  });

  it('holds the spell where the gestures are made in time', () => {
    const events = ready(faces(90));
    expect(fumbles(events)).toHaveLength(1);
    expect(fizzled(events)).toEqual([]);
    const after = fold('slow', [...FIGHT, ...events]);
    expect(after.creatures[WIZARD]!.readied?.response.kind).toBe('spell');
  });
});

describe('a cantrip cast with the swing: SRD True Strike', () => {
  /** The swing, and how many dice its issuer handed out — which the log must count. */
  let issued = 0;
  const swing = (rng: Rng) => {
    const state = fold('slow', FIGHT);
    const dice = supply(state, rng);
    const out = unwrap(
      resolveAttack(
        state,
        WIZARD,
        { target: GOBLIN, weapon: 'longsword', cantrip: { spellId: 'true-strike' } } as never,
        dice,
      ),
      'swing',
    );
    issued = dice.issuer.count;
    return out;
  };

  it('throws the die before the attack, and a failure spends the Action and makes no attack', () => {
    const out = swing(faces(10));
    expect(fumbles(out.events)).toHaveLength(1);
    expect(fizzled(out.events)).toHaveLength(1);
    expect(out.attack).toBeNull();
    expect(out.events.filter((event) => event.type === 'roll-recorded')).toHaveLength(1);
    const after = fold('slow', [...FIGHT, ...out.events]);
    expect(after.creatures[GOBLIN]!.vitals.hp).toBe(400);
    expect(after.combat?.budgets[WIZARD]?.action).toBe(false);
    // Every die the command threw is counted, so the next command's issuer
    // does not re-issue one.
    expect(after.rollsIssued).toBe(issued);
  });

  it('swings where the gestures are made in time', () => {
    const out = swing(faces(90, 15));
    expect(fumbles(out.events)).toHaveLength(1);
    expect(fizzled(out.events)).toEqual([]);
    expect(out.attack).not.toBeNull();
    const after = fold('slow', [...FIGHT, ...out.events]);
    // Counted once: the d100 is inside the command's own bracket, not beside it.
    expect(after.rollsIssued).toBe(issued);
  });
});

describe('a spell cast on a hit', () => {
  const smite = (rng: Rng) => {
    const state = fold('slow', FIGHT);
    const hit = unwrap(
      resolveAttack(
        state,
        WIZARD,
        { target: GOBLIN, weapon: 'longsword', twoHanded: true, hold: true } as never,
        supply(state, faces(15)),
      ),
      'hit',
    );
    const swung = [...FIGHT, ...hit.events];
    const held = fold('slow', swung);
    const settled = unwrap(
      resolveAttackDamage(
        held,
        WIZARD,
        { smite: { spellId: 'gesture-smite', slotLevel: 1 } },
        supply(held, rng),
      ),
      'smite',
    );
    return { log: [...swung, ...settled.events], events: settled.events };
  };

  it('throws the die for a smite with gestures, and a failure keeps the slot spent and adds no die', () => {
    const failed = smite(faces(10));
    expect(fumbles(failed.events)).toHaveLength(1);
    expect(fizzled(failed.events)).toHaveLength(1);
    const held = smite(faces(90));
    expect(fizzled(held.events)).toEqual([]);

    const after = fold('slow', failed.log);
    expect(remaining(after.creatures[WIZARD]!.resources, spellSlotKey(1))).toBe(3);
    // The weapon's own blow still lands, and the smite's 1d6 does not: the
    // casting that failed left nothing running either.
    const hurtFailed = 400 - after.creatures[GOBLIN]!.vitals.hp;
    const hurtHeld = 400 - fold('slow', held.log).creatures[GOBLIN]!.vitals.hp;
    expect(hurtFailed).toBeGreaterThan(0);
    expect(hurtHeld - hurtFailed).toBe(6);
    expect(Object.keys(after.ongoing)).toEqual([]);
  });

  it('throws nothing for an SRD smite, which is Verbal only', () => {
    const state = fold('slow', FIGHT);
    const hit = unwrap(
      resolveAttack(
        state,
        WIZARD,
        { target: GOBLIN, weapon: 'longsword', twoHanded: true, hold: true } as never,
        supply(state, faces(15)),
      ),
      'hit',
    );
    const swung = [...FIGHT, ...hit.events];
    const wizardSmites: GameEvent = {
      type: 'spellcasting-declared',
      id: WIZARD,
      spellcasting: declaredCasting({
        ability: 'int',
        classId: 'wizard',
        prepared: ['searing-smite'],
      }),
    };
    const log = [...swung, wizardSmites];
    const settled = unwrap(
      resolveAttackDamage(
        fold('slow', log),
        WIZARD,
        { smite: { spellId: 'searing-smite', slotLevel: 1 } },
        supply(fold('slow', log), faces(10)),
      ),
      'smite',
    );
    expect(fumbles(settled.events)).toEqual([]);
  });
});

describe('a spell a glyph stores: cast "as part of creating the glyph"', () => {
  const THRESHOLD = { x: 105, y: 100, z: 0 };

  /** Inscribed out of combat, slowed for the last of the hour, settled on the faces given. */
  const inscribed = (rng: Rng) => {
    const declared = unwrap(
      resolveSpell(
        fold('slow', FIELD),
        WIZARD,
        {
          spellId: 'glyph-of-warding',
          targets: [],
          at: THRESHOLD,
          slotLevel: 3,
          stores: { spellId: 'hold-person', slotLevel: 2 },
        } as never,
        supply(fold('slow', FIELD), faces()),
      ),
      'declare',
    );
    let log: GameEvent[] = [...FIELD, ...declared.events];
    const castingId = pendingCastingsOf(fold('slow', log))[0]!.castingId;
    log = [...log, ...unwrap(advanceTime(fold('slow', log), 3600, 'the hour'), 'hour'), SLOWED];
    const settled = unwrap(
      resolveDeclaredCast(fold('slow', log), castingId, supply(fold('slow', log), rng)),
      'settle',
    );
    return { castingId, events: settled.events, state: fold('slow', [...log, ...settled.events]) };
  };

  it('throws a die for the glyph and another for the spell it stores', () => {
    const { events, state, castingId } = inscribed(faces(90, 90));
    expect(fumbles(events)).toHaveLength(2);
    expect(fizzled(events)).toEqual([]);
    expect(state.ongoing[castingId]!.stored).toMatchObject({ spellId: 'hold-person' });
  });

  it('stores nothing, and lays no rune either, where the stored spell’s gestures fail', () => {
    const { events, state, castingId } = inscribed(faces(90, 10));
    expect(fumbles(events)).toHaveLength(2);
    expect(fizzled(events)).toHaveLength(1);
    const record = state.ongoing[castingId]!;
    // The glyph was made, and the spell inside it failed: a spell glyph with no
    // spell in it, and not the explosive rune the caster did not choose.
    expect(record.stored).toBeUndefined();
    expect(record.triggered).toBeUndefined();
    // Both slots are gone: the stored spell's was spent when it was cast.
    expect(remaining(state.creatures[WIZARD]!.resources, spellSlotKey(3))).toBe(3);
    expect(remaining(state.creatures[WIZARD]!.resources, spellSlotKey(2))).toBe(3);
  });

  it('throws only the glyph’s die where the glyph itself fails, and stores nothing', () => {
    const { events, state, castingId } = inscribed(faces(10));
    expect(fumbles(events)).toHaveLength(1);
    expect(fizzled(events)).toHaveLength(1);
    expect(state.ongoing[castingId]).toBeUndefined();
  });
});
