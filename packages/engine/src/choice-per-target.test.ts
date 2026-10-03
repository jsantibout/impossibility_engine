import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { resolveDeclaredCast, resolveSpell } from './commands.js';
import { rollModesFor } from './standing.js';
import { checkSpellDefinition } from './spell-schema.js';
import type { SpellDefinition } from './spell-definitions.js';

/**
 * SRD Enhance Ability, _Using a Higher-Level Spell Slot_: "You can target one
 * additional creature for each spell slot level above 2. **You can choose a
 * different ability for each target.**"
 *
 * The base casting chooses once — "You touch a creature and choose Strength,
 * Dexterity, Intelligence, Wisdom, or Charisma" — and `choice` already carries
 * that. The upcast lets the one casting answer the question again for each
 * creature it touches, so the Rogue's Dexterity and the Bard's Charisma come
 * out of one level 3 slot. `StatedChoice.perTarget` is the spell saying so,
 * and `CastSpellRequest.choiceByTarget` is the caster's answer, one value per
 * creature, checked against the same printed list.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const ROGUE = id('rogue');
const BARD = id('bard');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple'],
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const LOG: readonly GameEvent[] = [
  added(CLERIC),
  added(ROGUE),
  added(BARD),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({
      ability: 'wis',
      prepared: ['enhance-ability', 'blindness-deafness'],
    }),
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CLERIC,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 8, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the chapel', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the chapel' }, feet: 0 } },
  { type: 'creature-placed', id: ROGUE, placement: { from: { creature: CLERIC }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: BARD, placement: { from: { creature: CLERIC }, feet: 5, bearing: 90 } },
  { type: 'sight-declared', from: CLERIC, to: ROGUE, seen: true },
  { type: 'sight-declared', from: CLERIC, to: BARD, seen: true },
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: createRng('per-target'),
  content: SRD_CONTENT,
});

type Request = Parameters<typeof resolveSpell>[2];

const attempt = (over: Record<string, unknown>, log: readonly GameEvent[] = LOG) => {
  const state = fold('seed', log);
  return resolveSpell(
    state,
    CLERIC,
    { spellId: 'enhance-ability', targets: [ROGUE, BARD], slotLevel: 3, ...over } as Request,
    supply(state),
  ) as Result<{ readonly events: readonly GameEvent[]; readonly castingId?: string }>;
};

/** Whether a creature rolls ability checks of one ability with Advantage. */
const advantaged = (state: GameState, who: CharacterId, ability: string): boolean =>
  rollModesFor(state, { family: 'ability-check', roller: who, ability: ability as never }).modes.some(
    (mode) => (typeof mode === 'string' ? mode : mode.mode) === 'advantage',
  );

const code = (result: Result<unknown>): string | null => (isErr(result) ? result.code : null);

describe('SRD Enhance Ability: a different ability for each target', () => {
  it('gives each creature the ability chosen for it, and no other', () => {
    const cast = unwrap(attempt({ choiceByTarget: { [ROGUE]: 'dex', [BARD]: 'cha' } }), 'cast');
    const state = fold('seed', [...LOG, ...cast.events]);

    expect(advantaged(state, ROGUE, 'dex')).toBe(true);
    expect(advantaged(state, ROGUE, 'cha')).toBe(false);
    expect(advantaged(state, BARD, 'cha')).toBe(true);
    expect(advantaged(state, BARD, 'dex')).toBe(false);
    // Nobody got the Strength the definition carries as its placeholder.
    expect(advantaged(state, ROGUE, 'str')).toBe(false);
    expect(advantaged(state, BARD, 'str')).toBe(false);
  });

  it('still chooses once for everybody where the caster says one value', () => {
    const cast = unwrap(attempt({ choice: 'int' }), 'cast');
    const state = fold('seed', [...LOG, ...cast.events]);
    expect(advantaged(state, ROGUE, 'int')).toBe(true);
    expect(advantaged(state, BARD, 'int')).toBe(true);
  });

  it('settles a held casting with the values its declaration named', () => {
    const declared = unwrap(
      attempt({ choiceByTarget: { [ROGUE]: 'dex', [BARD]: 'cha' }, hold: true }),
      'declared',
    );
    const open = fold('seed', [...LOG, ...declared.events]);
    const settled = unwrap(
      resolveDeclaredCast(open, declared.castingId!, supply(open)),
      'settled',
    );
    const state = fold('seed', [...LOG, ...declared.events, ...settled.events]);
    expect(advantaged(state, ROGUE, 'dex')).toBe(true);
    expect(advantaged(state, BARD, 'cha')).toBe(true);
    expect(advantaged(state, BARD, 'dex')).toBe(false);
  });

  it('refuses the map beside a single answer, and an answer the list does not print', () => {
    expect(code(attempt({ choice: 'dex', choiceByTarget: { [ROGUE]: 'dex', [BARD]: 'cha' } }))).toBe(
      'choice_once_and_per_target',
    );
    // "Strength, Dexterity, Intelligence, Wisdom, or Charisma" — no Constitution.
    expect(code(attempt({ choiceByTarget: { [ROGUE]: 'dex', [BARD]: 'con' } }))).toBe('unknown_choice');
  });

  it('refuses a map that leaves a target unanswered or answers for somebody untouched', () => {
    expect(code(attempt({ choiceByTarget: { [ROGUE]: 'dex' } }))).toBe('choice_by_target_uncovered');
    expect(
      code(attempt({ targets: [ROGUE], slotLevel: 2, choiceByTarget: { [ROGUE]: 'dex', [BARD]: 'cha' } })),
    ).toBe('choice_by_target_uncovered');
  });

  it('refuses the map on a spell that chooses once for the whole casting', () => {
    const state = fold('seed', LOG);
    const refused = resolveSpell(
      state,
      CLERIC,
      {
        spellId: 'blindness-deafness',
        targets: [ROGUE],
        slotLevel: 2,
        choiceByTarget: { [ROGUE]: 'blinded' },
      } as Request,
      supply(state),
    );
    expect(code(refused)).toBe('no_per_target_choice_clause');
  });
});

describe('the validator holds a choice per target to a spell that can name several', () => {
  const enhance = SRD_CONTENT.spell('enhance-ability')!;
  const codes = (over: Partial<SpellDefinition>): readonly string[] =>
    checkSpellDefinition({ ...enhance, ...over } as SpellDefinition).map((one) => one.code);

  it('accepts Enhance Ability as written', () => {
    expect(enhance.choiceStated?.perTarget).toBe(true);
    expect(codes({})).toEqual([]);
  });

  it('refuses a malformed flag, and one on a spell that only ever touches one creature', () => {
    expect(
      codes({ choiceStated: { ...enhance.choiceStated!, perTarget: 'yes' as never } }),
    ).toContain('malformed_field');
    expect(codes({ targets: { count: 1, self: true } })).toContain('per_target_choice_on_one_target');
  });
});
