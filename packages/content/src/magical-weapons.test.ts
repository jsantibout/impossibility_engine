import { describe, expect, it } from 'vitest';
import { WEAPONS } from '@ie/srd';
import { isMagicalItem } from '@ie/engine';
import { transcribedItems } from '../scripts/magic-items.js';
import { SRD_CONTENT } from './index.js';

/**
 * `isMagicalItem`, held against the book in both directions. (W9-S4)
 *
 * SRD Magic Weapon's "You touch a **nonmagical** weapon" is answered by a
 * derivation rather than a field: a record that has grown grants or an
 * attunement is a magic item. A derivation is only as good as the corpus it
 * is right about, so this asks it of every weapon record there is — through
 * the record-to-entry join `transcribedItems` already makes, so "transcribed
 * from *Magic Items A–Z*" means what the coverage report means by it.
 */
describe('which weapons are magical', () => {
  const transcribedWeapons = transcribedItems().filter(([item]) => item.weapon !== null);

  it('reads every weapon transcribed from Magic Items A–Z as magical', () => {
    expect(transcribedWeapons.length).toBeGreaterThan(0);
    const mundane = transcribedWeapons
      .filter(([item]) => !isMagicalItem(item))
      .map(([item, entry]) => `${item.id} (${entry.name})`);
    expect(mundane).toEqual([]);
  });

  it('reads no weapon from the equipment tables as magical', () => {
    expect(WEAPONS.length).toBeGreaterThan(0);
    const magical = WEAPONS.filter((row) => {
      const item = SRD_CONTENT.item(row.id);
      if (item === null) throw new Error(`${row.id} is on the Weapons table and not in the catalogue`);
      return isMagicalItem(item);
    }).map((row) => row.id);
    expect(magical).toEqual([]);
  });
});
