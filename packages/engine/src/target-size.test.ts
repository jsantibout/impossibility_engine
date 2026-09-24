import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { resolveSpell } from './commands.js';

/**
 * A size a target rule asks for.
 *
 * > SRD Animal Messenger: "A **Tiny** Beast of your choice that you can see
 * > within range".
 *
 * `TargetRule` selected by creature type and by whether armour was worn, and
 * by nothing else — which is the first of the three facts
 * `a-target-rule-the-format-cannot-state` names. A size is a fact the engine
 * already holds authoritatively and reads through `effectiveSizeOf`, so the
 * only thing missing was a target rule that asked for it.
 *
 * It reads like `mustBeUnarmored` rather than like `mustBeType`: a size is
 * never a thin record the way a creature type is — a placement puts one on the
 * map — so a creature whose size nothing anywhere states is a plain no with a
 * reason naming what would settle it, rather than a question.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const DRUID = id('druid');
const RAVEN = id('raven');
const WOLF = id('wolf');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  ...over,
});

const added = (
  who: CharacterId,
  over: {
    readonly creatureType?: string;
    readonly size?: string;
    /**
     * **And the rating the block prints, where the spell reads one.**
     *
     * Animal Messenger's save spares a target whose Challenge Rating is not 0
     * and asks about a creature nobody has rated — the difference between a
     * missing fact and a wrong one, which `challenge-rating.test.ts` is about.
     * A fixture that left it out would be asked rather than answered, so it
     * states the rating exactly as it states the type and the size.
     */
    readonly cr?: number;
  } = {},
): GameEvent =>
  ({
    type: 'creature-added',
    id: who,
    name: who,
    sheet: sheet(),
    maxHp: 20,
    diesAtZero: false,
    ...over,
  }) as GameEvent;

const SETUP: readonly GameEvent[] = [
  added(DRUID, { creatureType: 'Humanoid', size: 'medium' }),
  // The SRD Raven, which is what a Tiny Beast is here: Beast, Tiny, and rated
  // at nothing, which is the one rating Animal Messenger's parenthesis leaves
  // the die to decide.
  added(RAVEN, { creatureType: 'Beast', size: 'tiny', cr: 0 }),
  added(WOLF, { creatureType: 'Beast', size: 'medium', cr: 0.25 }),
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'druid',
      prepared: ['animal-messenger'],
    }),
  },
  {
    type: 'resource-pool-declared',
    id: DRUID,
    pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 3, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the glade', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: DRUID, placement: { from: { landmark: 'the glade' }, feet: 0 } },
  { type: 'creature-placed', id: RAVEN, placement: { from: { creature: DRUID }, feet: 10 } },
  { type: 'creature-placed', id: WOLF, placement: { from: { creature: DRUID }, feet: 15 } },
  { type: 'sight-declared', from: DRUID, to: RAVEN, seen: true },
  { type: 'sight-declared', from: DRUID, to: WOLF, seen: true },
];

const supply = () => ({
  issuer: createRollIssuer('r'),
  rng: createRng('size') as Rng,
  content: SRD_CONTENT,
});

describe('what a definition may say about a size it demands', () => {
  const definition = (targets: unknown): unknown => ({
    id: 'homebrew-errand',
    name: 'Homebrew Errand',
    level: 2,
    school: 'enchantment',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'ranged', feet: 30 },
    targets,
    effects: [],
    durationSeconds: 60,
    unmodelled: ['what the errand is, is the DM’s'],
  });

  const codes = (targets: unknown): readonly string[] =>
    checkSpellDefinitionValue(definition(targets)).map((one) => one.code);

  it('accepts one of the six printed size categories', () => {
    expect(codes({ count: 1, mustBeSize: 'tiny' })).toEqual([]);
  });

  it('refuses a size that is not a size category', () => {
    expect(codes({ count: 1, mustBeSize: 'itsy' })).toContain('unknown_size');
  });
});

describe('Animal Messenger picks the Beast by its size', () => {
  const cast = (at: CharacterId) =>
    resolveSpell(
      fold('seed', SETUP),
      DRUID,
      { spellId: 'animal-messenger', targets: [at], slotLevel: 2 },
      supply(),
    );

  it('takes a Tiny Beast', () => {
    const out = cast(RAVEN);
    expect(unwrap(out, 'the raven carries it').events.length).toBeGreaterThan(0);
  });

  it('refuses a Medium one', () => {
    const out = cast(WOLF);
    expect(isErr(out) && out.code).toBe('wrong_creature_size');
    expect(isErr(out) && out.reason).toContain('Tiny');
  });
});
