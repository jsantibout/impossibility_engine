import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SPELL_INDEX, spellById } from '@ie/srd';
import { SPELL_DEFINITIONS } from './spell-definitions.js';
import { VERIFIED_SPELLS } from '../scripts/coverage.js';

const here = fileURLToPath(new URL('.', import.meta.url));

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

/**
 * A tracked spell is one the engine casts and does not execute: the slot, the
 * action, the Concentration and the clock are real, and the effect is the DM's.
 * The obligation that makes that honest rather than a stub is that it must say
 * so, and `unverified` carries `unmodelled` to the narrating layer on every
 * casting.
 */
describe('a spell the engine tracks says what it does not do', () => {
  const tracked = SPELL_DEFINITIONS.filter((d) => d.effects.length === 0);

  it('has some, so the rule below is not vacuous', () => {
    expect(tracked.length).toBeGreaterThan(0);
  });

  it.each(tracked.map((d) => [d.id, d] as const))(
    'leaves %s nothing unexplained',
    (_id, definition) => {
      expect(definition.unmodelled ?? []).not.toEqual([]);
    },
  );

  /** And an executed spell is still allowed to have nothing to declare. */
  it('does not demand a note from a spell that does everything it says', () => {
    const executed = SPELL_DEFINITIONS.filter((d) => d.effects.length > 0);
    expect(executed.some((d) => (d.unmodelled ?? []).length === 0)).toBe(true);
  });
});

describe('the coverage table cannot claim more than the tests prove', () => {
  it('verifies only spells the engine can execute', () => {
    const executable = new Set(SPELL_DEFINITIONS.map((d) => d.id));
    expect(VERIFIED_SPELLS.filter((id) => !executable.has(id))).toEqual([]);
  });

  it('names each verified spell once', () => {
    expect(new Set(VERIFIED_SPELLS).size).toBe(VERIFIED_SPELLS.length);
  });

  /**
   * And in an order two branches can both append to.
   *
   * Nothing above constrains the order — both neighbours compare sets — so a
   * merge resolution is free to scramble this list, and the next person to add
   * a spell conflicts with it again. Sorted, two additions usually land in
   * different places and never need resolving at all.
   */
  it('names them in an order two branches can both append to', () => {
    expect(VERIFIED_SPELLS).toEqual([...VERIFIED_SPELLS].sort());
  });

  /** The denominator is real: this is the whole SRD, not a sample of it. */
  it('measures against every parsed spell', () => {
    expect(SPELL_INDEX.length).toBe(339);
  });
});

/**
 * The registry is a list two branches both append to.
 *
 * Sorted, two people adding a spell append in different places and never meet.
 * Unsorted — as this list was, with seventeen utility spells prepended out of
 * order — every addition lands at whatever line looked reasonable, which means
 * every pair of additions is a conflict at the same hunk. And the resolution of
 * that conflict is where an entry gets dropped or landed twice, neither of
 * which anything else here would notice.
 */
describe('the catalogue is a list a merge cannot quietly damage', () => {
  const ids = () => SPELL_DEFINITIONS.map((d) => d.id);

  it('names each spell once', () => {
    expect(new Set(ids()).size).toBe(ids().length);
  });

  it('is sorted by id', () => {
    expect(ids()).toEqual([...ids()].sort());
  });

  /**
   * The failure a bad resolution actually produces: a spell still *declared*
   * and no longer *registered*. It compiles, it lints, and `definitionFor`
   * simply stops finding it — so the engine reports a spell it has been taught
   * as one it has never heard of.
   *
   * Read out of the source, the way `persistence.test.ts` reads the event
   * union, because the whole point is to catch what the type system cannot:
   * a definition that exists as a value nobody put in the list.
   */
  it('registers every spell the file declares', () => {
    const source = readFileSync(`${here}spell-definitions.ts`, 'utf8');

    // Each `export const` up to the next one; a block carrying an `id` is a
    // spell definition, which leaves out DIRECTIONAL_AREAS and the list itself.
    const blocks = source.split(/^export const /m).slice(1);
    const declared = blocks
      .map((block) => /^\s*id: '([a-z0-9-]+)'/m.exec(block)?.[1])
      .filter((id): id is string => id !== undefined);

    expect(declared.length).toBeGreaterThan(80);
    expect([...declared].sort()).toEqual([...ids()].sort());
  });
});
