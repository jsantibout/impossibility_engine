import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type RollMode,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { castingIdOf } from './spells.js';
import { declaredCasting } from './spellcasting.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { endConcentration, resolveAttack, resolveSpell } from './commands.js';
import { GREATER_INVISIBILITY, INVISIBILITY } from './spell-definitions.js';

/**
 * A condition a spell imposes with **no saving throw**.
 *
 * The `save` shape minus the roll: the condition is applied to every resolved
 * target with the casting link, and nothing is thrown, because the SRD asks
 * for nothing to be thrown. Two spells prove it, and between them they cover
 * both halves of what the kind has to get right:
 *
 * | Spell | What it proves |
 * |---|---|
 * | Greater Invisibility | the condition lands linked, `conditions.ts` reads it, the casting's end lifts it |
 * | Invisibility | the same kind upcast — one more target per slot level above 2 |
 *
 * The fixture supplies who exists, who prepared what and where everybody is
 * standing. It supplies no condition, no duration and no target count: those
 * are the definitions', which is the whole point of the kind existing.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('elmina');
const SCOUT = id('tarin');
const OTHER = id('brandis');
const GOBLIN = id('goblin');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const MOOK = sheet({
  level: 1,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
});

const added = (who: CharacterId, maxHp: number, over?: Partial<CharacterSheet>): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: over === undefined ? sheet() : sheet(over),
  maxHp,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const slot = (level: number, max: number): GameEvent => ({
  type: 'resource-pool-declared',
  id: WIZARD,
  pool: { key: spellSlotKey(level), label: `level ${level} spell slot`, max, recovers: 'long-rest' },
});

/**
 * Everybody is within Touch of the wizard, because both spells are Touch.
 *
 * Sight from the goblin is deliberately **not** declared: SRD Invisible gives
 * an attacker Disadvantage unless it can see the target, and a fixture that
 * declared the sight line would hand the goblin the exemption and hide the
 * rule this file is here to read.
 */
const SETUP: readonly GameEvent[] = [
  added(WIZARD, 40),
  added(SCOUT, 24, MOOK),
  added(OTHER, 24, MOOK),
  added(GOBLIN, 12, MOOK),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      cantrips: [],
      prepared: ['invisibility', 'greater-invisibility'],
    }),
  },
  slot(2, 3),
  slot(3, 3),
  slot(4, 3),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the arch', at: { x: 20, y: 20, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the arch' }, feet: 0 } },
  { type: 'creature-placed', id: SCOUT, placement: { from: { creature: WIZARD }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: OTHER, placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: SCOUT }, feet: 5, bearing: 0 } },
];

const base = (): GameState => fold('seed', SETUP);

const supply = (seed: string) => {
  const rng: Rng = createRng(seed);
  return { issuer: createRollIssuer('r'), rng };
};

/** The goblin swings at the scout. The roll's mode is the whole assertion. */
const swing = (state: GameState, seed: string): RollMode => {
  const out = unwrap(
    resolveAttack(state, GOBLIN, { target: SCOUT, weapon: null, free: true }, supply(seed)),
    'swing',
  );
  if (out.attack === null) throw new Error('the goblin did not swing');
  return out.attack.mode;
};

describe('a condition applied with no saving throw', () => {
  /**
   * SRD Greater Invisibility: "A creature you touch has the Invisible
   * condition until the spell ends." No save is offered, so none is rolled —
   * and the generator must not move for a die the rules never asked for.
   */
  it('lands the condition without rolling anything', () => {
    const out = unwrap(
      resolveSpell(
        base(),
        WIZARD,
        { spellId: 'greater-invisibility', targets: [SCOUT], slotLevel: 4 },
        supply('touch'),
      ),
      'cast',
    );

    expect(out.outcomes).toEqual([{ target: SCOUT, condition: 'invisible', affected: true }]);
    // The `save` shape minus the roll: no D20 was recorded, and nothing was
    // issued, so a replay of this log restores the same generator state.
    expect(out.events.some((e) => e.type === 'roll-recorded')).toBe(false);
    expect(out.events.some((e) => e.type === 'rolls-issued')).toBe(false);
  });

  /** The condition carries the casting's own link: `Greater Invisibility#cast:N`. */
  it('links the condition to the casting that caused it', () => {
    const out = unwrap(
      resolveSpell(
        base(),
        WIZARD,
        { spellId: 'greater-invisibility', targets: [SCOUT], slotLevel: 4 },
        supply('link'),
      ),
      'cast',
    );
    const after = fold('seed', [...SETUP, ...out.events]);

    const instance = after.creatures[SCOUT]?.conditions.instances.find(
      (i) => i.condition === 'invisible',
    );
    expect(instance).toBeDefined();
    expect(castingIdOf(instance!.source)).toBe(out.castingId);
    expect(instance!.source).toBe(`Greater Invisibility#${out.castingId}`);
  });

  /**
   * The point of applying a real condition rather than noting one: every rule
   * `conditions.ts` already computes now reads it. SRD Invisible: an attack
   * roll against the creature has Disadvantage unless the attacker can see it.
   */
  it('is read by an attack against the target, and lifts when the casting ends', () => {
    expect(swing(base(), 'plain')).toBe('normal');

    const out = unwrap(
      resolveSpell(
        base(),
        WIZARD,
        { spellId: 'greater-invisibility', targets: [SCOUT], slotLevel: 4 },
        supply('hide'),
      ),
      'cast',
    );
    const hidden = fold('seed', [...SETUP, ...out.events]);
    expect(swing(hidden, 'plain')).toBe('disadvantage');

    // SRD: "Concentration, up to 1 minute" — dropping it takes the condition
    // with it, through the casting link and nothing else.
    const ended = unwrap(endConcentration(hidden, WIZARD, 'voluntary'), 'end');
    const visible = fold('seed', [...SETUP, ...out.events, ...ended]);
    expect(visible.creatures[SCOUT]?.conditions.conditions).not.toContain('invisible');
    expect(swing(visible, 'plain')).toBe('normal');
  });

  /**
   * SRD Invisibility, _Using a Higher-Level Spell Slot_: "You can target one
   * additional creature for each spell slot level above 2." The count is the
   * definition's and the slot's; nothing in this file says two.
   */
  it('takes one more target per slot level above the spell’s own', () => {
    const state = base();
    const two = unwrap(
      resolveSpell(
        state,
        WIZARD,
        { spellId: 'invisibility', targets: [SCOUT, OTHER], slotLevel: 3 },
        supply('upcast'),
      ),
      'cast',
    );
    expect(two.outcomes.map((o) => o.target)).toEqual([SCOUT, OTHER]);

    const after = fold('seed', [...SETUP, ...two.events]);
    expect(after.creatures[SCOUT]?.conditions.conditions).toContain('invisible');
    expect(after.creatures[OTHER]?.conditions.conditions).toContain('invisible');

    // And at its own level it reaches one, with the slot unspent on refusal.
    const refused = resolveSpell(
      state,
      WIZARD,
      { spellId: 'invisibility', targets: [SCOUT, OTHER], slotLevel: 2 },
      supply('too-many'),
    );
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('too_many_targets');
    expect(remaining(state.creatures[WIZARD]!.resources, spellSlotKey(2))).toBe(3);
  });

  /**
   * The numbers, each against the printed line. The oracle checks the range
   * and the duration against the book; these are the two the oracle cannot
   * see, because they live in the effect rather than in a printed field.
   */
  it('carries the SRD’s own condition and level for each spell', () => {
    expect(GREATER_INVISIBILITY.level).toBe(4);
    expect(GREATER_INVISIBILITY.effects).toEqual([
      { kind: 'condition', condition: { name: 'invisible' } },
    ]);
    expect(GREATER_INVISIBILITY.durationSeconds).toBe(60);

    expect(INVISIBILITY.level).toBe(2);
    expect(INVISIBILITY.effects).toEqual([{ kind: 'condition', condition: { name: 'invisible' } }]);
    expect(INVISIBILITY.durationSeconds).toBe(3600);
    expect(INVISIBILITY.targets.extraPerSlotLevelAbove).toBe(1);
  });

  /**
   * SRD Invisibility: "The spell ends early immediately after the target makes
   * an attack roll, deals damage, or casts a spell." Nothing ends a casting
   * when its target acts, so the clause is debt and is adjudicated as such —
   * which is why Invisibility is partial and Greater Invisibility is not.
   */
  it('says plainly that Invisibility’s early end is not built', () => {
    expect(INVISIBILITY.unmodelled?.join(' ')).toMatch(/ends early/i);
    expect(GREATER_INVISIBILITY.unmodelled ?? []).toEqual([]);
  });
});
