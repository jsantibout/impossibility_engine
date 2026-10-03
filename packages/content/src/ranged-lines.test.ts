import { describe, expect, it } from 'vitest';
import { checkContent, extendContent, lineName, loadContent } from '@ie/engine';
import { expect as unwrap, isErr } from '@ie/shared';
import { SRD_CONTENT } from './index.js';
import { SRD_RANGED_LINES } from './ranged-lines.js';

/**
 * The projectile table against the bestiary. (E-L2, the owner's ruling of
 * 2026-10-03: "a content table, decided once")
 *
 * Every printed ranged line in the SRD's stat blocks that is named after no
 * catalogue weapon a creature fires or throws is decided in
 * `SRD_RANGED_LINES` — so a new block's line cannot slip past SRD Wind Wall
 * undecided, and no row decides a line nobody prints.
 */

const loosedByAWeapon = new Set(
  SRD_CONTENT.items
    .filter(
      (item) => item.weapon !== null && (item.weapon.ammunitionRange !== null || item.weapon.thrownRange !== null),
    )
    .map((item) => item.name.toLowerCase()),
);

/** Every printed ranged line, by the name the table reads, with the CR of each block that prints it. */
const printedRangedLines = (): Map<string, number[]> => {
  const found = new Map<string, number[]>();
  for (const block of SRD_CONTENT.monsters) {
    for (const list of [block.actions, block.bonusActions, block.reactions, block.legendaryActions]) {
      for (const line of list ?? []) {
        if (line.attack === null || line.attack === undefined || line.attack.range === null) continue;
        const name = lineName(line.name);
        if (loosedByAWeapon.has(name)) continue;
        found.set(name, [...(found.get(name) ?? []), block.cr]);
      }
    }
  }
  return found;
};

describe('the projectile table', () => {
  it('decides every printed ranged line named after no weapon', () => {
    const printed = printedRangedLines();
    const undecided = [...printed.keys()].filter((name) => SRD_CONTENT.rangedLineNamed(name) === null).sort();
    expect(undecided).toEqual([]);
  });

  it('decides no line a block does not print', () => {
    const printed = printedRangedLines();
    const stray = SRD_RANGED_LINES.filter((row) => !printed.has(lineName(row.name))).map((row) => row.name);
    expect(stray).toEqual([]);
  });

  it('calls arrows and thrown spikes ordinary, and fire and boulders not', () => {
    const ordinary = (name: string) => SRD_CONTENT.rangedLineNamed(name)?.ordinaryProjectile;
    expect(ordinary('Tail Spike')).toBe(true);
    expect(ordinary('Bone Bow')).toBe(true);
    expect(ordinary('Hurl Flame')).toBe(false);
    expect(ordinary('Boulder')).toBe(false);
    // The three once left to the table (the owner's ruling of 2026-10-03,
    // "decided once"): a Giant's arrow is an arrow and a thrown blade that
    // returns is a thrown blade; a Huge creature's hurled volley of bark is not.
    expect(ordinary('Great Bow')).toBe(true);
    expect(ordinary('Flying Sword')).toBe(true);
    expect(ordinary('Hail of Bark')).toBe(false);
    // Read the way a stat block prints a heading, form note and all.
    expect(SRD_CONTENT.rangedLineNamed('Harpoon (Merrow Form Only)')?.id).toBe('harpoon');
  });
});

describe('a homebrew projectile table comes through the same door', () => {
  it('takes a row from JSON text and reads it by the line’s name', () => {
    const built = unwrap(
      loadContent(JSON.parse('{"rangedLines":[{"id":"spore-dart","name":"Spore Dart","ordinaryProjectile":true}]}')),
      'homebrew',
    );
    expect(built.rangedLineNamed('Spore Dart')?.ordinaryProjectile).toBe(true);
    expect(unwrap(extendContent(SRD_CONTENT, built), 'extended').rangedLineNamed('spore dart')?.id).toBe('spore-dart');
  });

  it('refuses a row that is not a row, a line decided twice, and a name no heading would match', () => {
    const loose = loadContent({ rangedLines: [{ id: 'spore-dart', name: 'Spore Dart' }] });
    expect(isErr(loose) && loose.reason).toContain('bad_ranged_line');

    expect(
      checkContent({
        rangedLines: [
          { id: 'rock', name: 'Rock', ordinaryProjectile: true },
          { id: 'rock-two', name: 'rock', ordinaryProjectile: false },
          { id: 'harpoon', name: 'Harpoon (Merrow Form Only)', ordinaryProjectile: true },
        ],
      })
        .map((problem) => problem.code)
        .sort(),
    ).toEqual(['bad_line_name', 'duplicate_name']);
  });
});
