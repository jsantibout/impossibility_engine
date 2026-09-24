import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { typeMagicSees } from './creature-type.js';
import { resolveSpell } from './commands.js';

/**
 * A creature fact an effect overrides.
 *
 * > SRD Arcanist's Magic Aura, _Mask (Creature)_: "Choose a creature type
 * > other than the target's actual type. **Spells and other magical effects
 * > treat the target as if it were a creature of the chosen type.**"
 *
 * A creature's type is a fact the engine holds authoritatively and refuses to
 * contradict — `creature-type-declared` is not re-declarable, because what a
 * creature *is* cannot be argued with. The Mask does not argue with it: it
 * leaves the fact standing and changes what one class of reader believes,
 * which is why it is a sourced grant beside the fact rather than a write over
 * it.
 *
 * **Where the line falls, and why.** The sentence names its own readers:
 * *spells and other magical effects*. So a spell's target rule, an area's
 * filter and an outcome that varies by type all read the Mask; a creature
 * reading another creature does not — SRD Ghoul's claw excepts "a non-Undead
 * creature", and a Ghoul does not cast a spell to claw somebody. The reader is
 * one function, `typeMagicSees`, so which side of the line a call site is on
 * is a visible choice rather than an accident of which field it happened to
 * reach for.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WIZARD = id('wizard');
const GOBLIN = id('goblin');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId, creatureType: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 30,
  diesAtZero: false,
  creatureType,
});

const SETUP: readonly GameEvent[] = [
  added(WIZARD, 'Humanoid'),
  // SRD 5.2.1 prints a Goblin Warrior as "Small **Fey** (Goblinoid)", which is
  // the whole reason this spell is worth testing with one: Hold Person takes a
  // Humanoid, and a goblin is not one.
  added(GOBLIN, 'Fey'),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      prepared: ['arcanists-magic-aura', 'hold-person'],
    }),
  },
  ...[2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WIZARD,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 3,
        recovers: 'long-rest',
      },
    }),
  ),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the study', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the study' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: WIZARD }, feet: 5 } },
  { type: 'sight-declared', from: WIZARD, to: GOBLIN, seen: true },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** The Mask laid on the goblin, with the type the caster chose. */
const masked = (chosen = 'Humanoid'): GameState => {
  const base = fold('seed', SETUP);
  const out = unwrap(
    resolveSpell(
      base,
      WIZARD,
      { spellId: 'arcanists-magic-aura', targets: [GOBLIN], slotLevel: 2, willing: [GOBLIN], choice: chosen },
      supply('mask'),
    ),
    'the mask',
  );
  return out.events.reduce(applyEvent, base);
};

describe('what a definition may say about a type it overrides', () => {
  const definition = (over: Record<string, unknown>): unknown => ({
    id: 'homebrew-guise',
    name: 'Homebrew Guise',
    level: 2,
    school: 'illusion',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'touch' },
    targets: { count: 1 },
    effects: [{ kind: 'creature-type-override', creatureType: 'Humanoid' }],
    durationSeconds: 3600,
    ...over,
  });

  const codes = (over: Record<string, unknown>): readonly string[] =>
    checkSpellDefinitionValue(definition(over)).map((one) => one.code);

  it('accepts one of the fourteen printed creature types', () => {
    expect(codes({})).toEqual([]);
  });

  it('refuses a type that is not one of the fourteen', () => {
    expect(codes({ effects: [{ kind: 'creature-type-override', creatureType: 'Goblinoid' }] })).toContain(
      'unknown_creature_type',
    );
  });

  /**
   * The grant runs for the casting, so an Instantaneous one could never lift
   * it — the rule `checkGrantLifetimes` already holds every other grant to.
   */
  it('refuses an override on a casting that leaves nothing running', () => {
    expect(codes({ durationSeconds: undefined })).toContain('grant_without_lifetime');
  });
});

describe("Arcanist's Magic Aura, the Mask", () => {
  it('leaves the creature’s own type exactly where it was', () => {
    const state = masked();
    expect(state.creatures[GOBLIN]?.creatureType).toBe('Fey');
  });

  it('is what a spell sees', () => {
    expect(typeMagicSees(masked().creatures[GOBLIN]!)).toBe('Humanoid');
  });

  it('lets Hold Person catch a masked goblin', () => {
    const state = masked();
    const out = resolveSpell(
      state,
      WIZARD,
      { spellId: 'hold-person', targets: [GOBLIN], slotLevel: 3 },
      supply('hold'),
    );
    expect(isErr(out) && out.code).not.toBe('wrong_creature_type');
    expect(unwrap(out, 'the hold').events.length).toBeGreaterThan(0);
  });

  it('refuses Hold Person on the same goblin unmasked', () => {
    const out = resolveSpell(
      fold('seed', SETUP),
      WIZARD,
      { spellId: 'hold-person', targets: [GOBLIN], slotLevel: 3 },
      supply('hold'),
    );
    expect(isErr(out) && out.code).toBe('wrong_creature_type');
  });

  it('is not what a creature reading a creature sees', () => {
    // SRD Ghoul: "If the target is a non-Undead creature". A stat block's line
    // is one creature reading another, which the spell's own sentence does not
    // reach — so the fact the claw asks for is the goblin's own.
    expect(masked().creatures[GOBLIN]?.creatureType).toBe('Fey');
  });

  it('ends when the casting does, through the door every grant ends through', () => {
    const state = masked();
    const record = Object.values(state.ongoing).find(
      (one) => one.spellId === 'arcanists-magic-aura',
    );
    expect(record).toBeDefined();
    const after = applyEvent(state, {
      type: 'spell-ended',
      castingId: record!.castingId,
      on: null,
      reason: 'dispelled',
    });
    expect(typeMagicSees(after.creatures[GOBLIN]!)).toBe('Fey');
  });

  it('refuses the type the creature already is, which the book forbids', () => {
    const base = fold('seed', SETUP);
    const out = resolveSpell(
      base,
      WIZARD,
      { spellId: 'arcanists-magic-aura', targets: [GOBLIN], slotLevel: 2, willing: [GOBLIN], choice: 'Fey' },
      supply('mask'),
    );
    expect(isErr(out) && out.code).toBe('same_creature_type');
  });
});
