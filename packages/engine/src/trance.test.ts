import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import { createRng, restoreRng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { createCharacter, planCharacter, type CharacterChoices } from './creation.js';
import { hours } from './time.js';
import { LONG_REST, LONG_REST_COOLDOWN, SHORT_REST, beginRest, endRest } from './rest.js';
import { LONGEST_LONG_REST } from './feature-schema.js';

/**
 * Trance: a Long Rest in four hours.
 *
 * SRD: "You don't need to sleep, and magic can't put you to sleep. You can
 * finish a Long Rest in 4 hours if you spend those hours in a trancelike
 * meditation, during which you retain consciousness."
 *
 * A Long Rest was eight hours for everybody — one constant inside `rest.ts`
 * with no per-creature answer — so a trait that shortens it for its holder
 * alone had nothing to bend. It is a fact of the sheet now, read off the
 * creature the rest belongs to, and absent on every sheet ever written, which
 * is what keeps eight hours the answer for everybody else.
 *
 * **The sixteen-hour cooldown is untouched**, because the SRD does not shorten
 * it: an Elf finishes sooner and still waits as long before starting another.
 */

const id = (s: string) => asCharacterId(s);
const ELF = id('nuala');
const HUMAN = id('bran');

const roller = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: state.rng === null ? createRng('seed') : restoreRng(state.rng),
  content: SRD_CONTENT,
});

const clock = (seconds: number, reason = 'resting'): GameEvent => ({
  type: 'time-advanced',
  seconds,
  reason,
});

const rogue = (speciesId: string, name: string): CharacterChoices => ({
  name,
  classId: 'rogue',
  level: 1,
  speciesId,
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 15, con: 14, int: 13, wis: 12, cha: 8 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['stealth', 'perception', 'acrobatics', 'investigation'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'rogue:expertise': ['stealth', 'perception'],
    ...(speciesId === 'elf'
      ? { 'elf:elven-lineage': ['Wood Elf'], 'elf:keen-senses': ['perception'] }
      : { 'human:skillful': ['perception'] }),
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    ...(speciesId === 'human' ? { 'human:versatile': { featId: 'alert' } } : {}),
  },
  ...(speciesId === 'elf' ? { featureSpellcasting: { 'elf:elven-lineage': 'wis' as const } } : {}),
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const born = (speciesId: string, who: CharacterId, name: string) =>
  unwrap(createCharacter(SRD_CONTENT, rogue(speciesId, name), who), 'create') as GameEvent[];

const party = (): GameEvent[] => [
  ...born('elf', ELF, 'Nuala'),
  ...born('human', HUMAN, 'Bran'),
];

/** Begin a Long Rest, let `seconds` pass, and try to end it. */
const slept = (log: readonly GameEvent[], who: CharacterId, seconds: number) => {
  const begun = [...log, ...unwrap(beginRest(fold('seed', log), who, 'long'), 'begin')];
  const waited = [...begun, clock(seconds)];
  const state = fold('seed', waited);
  return { log: waited, state, result: endRest(state, who, {}, roller(state)) };
};

describe('a Long Rest is as long as the sheet says', () => {
  /**
   * The validator's copy of the constant, held to the rest's own.
   *
   * `feature-schema.ts` cannot import `rest.ts` — `rest.ts` reads a character
   * back out of `creation.ts` and this validator is what `content.ts` runs —
   * so it spells the eight hours itself and refuses a grant that does not come
   * in under them. This is the one place both are in scope.
   */
  it('validates a shortened rest against the length the rest actually uses', () => {
    expect(LONGEST_LONG_REST).toBe(LONG_REST);
  });

  it('writes four hours onto an Elf’s sheet and nothing onto anybody else’s', () => {
    const elf = unwrap(planCharacter(SRD_CONTENT, rogue('elf', 'Nuala')), 'elf');
    const human = unwrap(planCharacter(SRD_CONTENT, rogue('human', 'Bran')), 'human');
    expect(elf.sheet.longRestSeconds).toBe(hours(4));
    expect(human.sheet.longRestSeconds).toBeUndefined();
  });

  /** SRD: "You can finish a Long Rest in 4 hours". */
  it('lets the Elf finish after four hours', () => {
    const taken = slept(party(), ELF, hours(4));
    const settled = unwrap(taken.result, 'end rest');
    expect(settled.benefit).toBe('long');
  });

  /** And everybody else still waits the eight the engine holds for all. */
  it('refuses the Human at four hours and pays in full at eight', () => {
    const early = slept(party(), HUMAN, hours(4));
    expect(isErr(early.result)).toBe(true);
    if (isErr(early.result)) {
      expect(early.result.code).toBe('rest_incomplete');
      // The message names the length this creature's rest actually takes.
      expect(early.result.reason).toContain(String(LONG_REST));
    }
    expect(unwrap(slept(party(), HUMAN, hours(8)).result, 'end rest').benefit).toBe('long');
  });

  /** The Elf's own message names four hours, not eight. */
  it('measures the Elf against four hours when it is refused at three', () => {
    const early = slept(party(), ELF, hours(3));
    expect(isErr(early.result)).toBe(true);
    if (isErr(early.result)) {
      expect(early.result.code).toBe('rest_incomplete');
      expect(early.result.reason).toContain(String(hours(4)));
      expect(early.result.reason).not.toContain(String(LONG_REST));
    }
  });

  /**
   * SRD does not shorten the wait: "you must wait at least 16 hours before
   * starting another one", and Trance says nothing about it.
   */
  it('leaves the sixteen-hour cooldown exactly where it was', () => {
    const taken = slept(party(), ELF, hours(4));
    const settled = unwrap(taken.result, 'end rest');
    const rested = [...taken.log, ...settled.events];

    const tooSoon = beginRest(fold('seed', [...rested, clock(hours(10))]), ELF, 'long');
    expect(isErr(tooSoon)).toBe(true);
    if (isErr(tooSoon)) expect(tooSoon.code).toBe('too_soon');

    const later = beginRest(fold('seed', [...rested, clock(LONG_REST_COOLDOWN)]), ELF, 'long');
    expect(later.ok).toBe(true);
  });

  /** A Long Rest the Elf interrupts collapses to a Short one, as anybody's does. */
  it('collapses an interrupted Trance to a Short Rest', () => {
    const begun = [...party(), ...unwrap(beginRest(fold('seed', party()), ELF, 'long'), 'begin')];
    const waited = [...begun, clock(hours(3))];
    const state = fold('seed', waited);
    const settled = unwrap(
      endRest(state, ELF, { interrupted: 'a patrol came through' }, roller(state)),
      'end rest',
    );
    expect(settled.benefit).toBe('short');
    // And an hour is still an hour: less than that earns nothing.
    const early = fold('seed', [...begun, clock(SHORT_REST - 60)]);
    const nothing = endRest(early, ELF, { interrupted: 'a patrol came through' }, roller(early));
    expect(unwrap(nothing, 'end rest').benefit).toBe('none');
  });
});
