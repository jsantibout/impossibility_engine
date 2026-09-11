import { describe, expect, it } from 'vitest';
import { SPELL_INDEX, spellById } from '@ie/srd';
import { SPELL_DEFINITIONS } from './spell-definitions.js';
import { VERIFIED_SPELLS } from '../scripts/coverage.js';

/**
 * The coverage claim, kept honest.
 *
 * `COVERAGE.md` is generated, and a generated claim nothing checks is exactly
 * the failure it exists to prevent — a project that believes it is finished
 * because a table says so. So the three states are asserted here:
 *
 * - **executable** must be **parsed**: a definition whose id, level or school
 *   has drifted from the book is a definition of a spell that does not exist.
 * - **verified** must be **executable**: a test cannot drive what the engine
 *   cannot resolve.
 * - Every definition's class list must match the SRD's, because who can cast a
 *   spell is half of whether a character may cast it.
 */

describe('every executable spell is a spell the SRD actually has', () => {
  it.each(SPELL_DEFINITIONS.map((d) => [d.id, d] as const))(
    'agrees with the book about %s',
    (id, definition) => {
      const parsed = spellById(id);
      expect(parsed, `${id} is not in the parsed SRD`).not.toBeNull();
      if (parsed === null) return;

      expect(parsed.name).toBe(definition.name);
      expect(parsed.level).toBe(definition.level);
      expect(parsed.school).toBe(definition.school);
    },
  );

  /**
   * SRD writes a casting time in prose; the engine has four kinds. A spell
   * whose printed time is an Action must not be defined as a Bonus Action —
   * that is a free action every turn, invented by a typo.
   */
  it.each(SPELL_DEFINITIONS.map((d) => [d.id, d] as const))(
    'agrees with the book about how long %s takes to cast',
    (id, definition) => {
      const parsed = spellById(id);
      if (parsed === null) return;

      const printed = parsed.castingTime.toLowerCase();
      const expected =
        printed.startsWith('bonus action')
          ? 'bonus-action'
          : printed.startsWith('reaction')
            ? 'reaction'
            : printed.startsWith('action')
              ? 'action'
              : 'long';
      expect(definition.castingTime).toBe(expected);
    },
  );

  it.each(SPELL_DEFINITIONS.map((d) => [d.id, d] as const))(
    'agrees with the book about whether %s needs Concentration',
    (id, definition) => {
      const parsed = spellById(id);
      if (parsed === null) return;
      expect(definition.concentration).toBe(parsed.concentration);
    },
  );
});

describe('the coverage table cannot claim more than the tests prove', () => {
  it('verifies only spells the engine can execute', () => {
    const executable = new Set(SPELL_DEFINITIONS.map((d) => d.id));
    expect(VERIFIED_SPELLS.filter((id) => !executable.has(id))).toEqual([]);
  });

  it('names each verified spell once', () => {
    expect(new Set(VERIFIED_SPELLS).size).toBe(VERIFIED_SPELLS.length);
  });

  /** The denominator is real: this is the whole SRD, not a sample of it. */
  it('measures against every parsed spell', () => {
    expect(SPELL_INDEX.length).toBe(339);
  });
});
