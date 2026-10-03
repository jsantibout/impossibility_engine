import { describe, expect, it } from 'vitest';
import { ARMOR, WEAPONS } from '@ie/srd';
import { SRD_CONTENT } from './index.js';
import { SRD_OBJECT_MATERIALS } from './objects.js';

/**
 * What every SRD weapon and suit of armour is made of — the mark SRD Heat
 * Metal reads (E-L1, the owner's answer of 2026-10-03: "mark it in the data").
 *
 * The reading is the Tools table's **Craft** lines, quoted in `items.ts`
 * beside `METAL`: a smith's or a tinker's row is metal, a carpenter's,
 * woodcarver's, leatherworker's or weaver's is not. This file holds that
 * every row was read and spot-checks the reading against the examples the
 * owner gave; it is not a second copy of the table.
 */

/** The rows no craft names, which carry no mark on purpose. */
const UNSAID_ROWS: readonly string[] = ['shield'];

const rowOf = (item: { readonly weapon: { readonly id: string } | null; readonly armor: { readonly id: string } | null }) =>
  item.weapon?.id ?? item.armor?.id ?? null;

describe('the metal mark on weapons and armour', () => {
  it('is stated on every row of the Weapons and Armor tables but the Shield', () => {
    const unread = [...WEAPONS, ...ARMOR]
      .filter((row) => !UNSAID_ROWS.includes(row.id))
      .filter((row) => typeof SRD_CONTENT.item(row.id)?.metal !== 'boolean')
      .map((row) => row.id);
    expect(unread).toEqual([]);
    expect(SRD_CONTENT.item('shield')?.metal).toBeUndefined();
  });

  it('reads the owner’s examples the way the owner did', () => {
    const metal = (id: string) => SRD_CONTENT.item(id)?.metal;
    expect(metal('longsword')).toBe(true);
    expect(metal('chain-mail')).toBe(true);
    expect(metal('club')).toBe(false);
    expect(metal('leather-armor')).toBe(false);
    expect(metal('hide-armor')).toBe(false);
  });

  it('follows the Craft lines: a smith’s and a tinker’s rows are metal, the rest are not', () => {
    const metal = (id: string) => SRD_CONTENT.item(id)?.metal;
    // Smith's Tools: "Any Melee weapon (except Club, Greatclub, Quarterstaff,
    // and Whip), Medium armor (except Hide), Heavy armor".
    for (const row of WEAPONS.filter((one) => one.kind === 'melee')) {
      const excepted = ['club', 'greatclub', 'quarterstaff', 'whip'].includes(row.id);
      expect([row.id, metal(row.id)]).toEqual([row.id, !excepted]);
    }
    for (const row of ARMOR.filter((one) => one.category === 'medium' || one.category === 'heavy')) {
      expect([row.id, metal(row.id)]).toEqual([row.id, row.id !== 'hide-armor']);
    }
    for (const row of ARMOR.filter((one) => one.category === 'light')) {
      expect([row.id, metal(row.id)]).toEqual([row.id, false]);
    }
    // Tinker's Tools: "Musket, Pistol"; Woodcarver's: "Ranged weapons (except
    // Pistol, Musket, and Sling)"; Leatherworker's: "Sling".
    for (const row of WEAPONS.filter((one) => one.kind === 'ranged')) {
      expect([row.id, metal(row.id)]).toEqual([row.id, row.id === 'musket' || row.id === 'pistol']);
    }
  });

  it('carries a magic version’s mark from the row it is built on, and no staff’s', () => {
    for (const item of SRD_CONTENT.items) {
      const row = rowOf(item);
      if (row === null) continue;
      if (item.kind === 'staff' || UNSAID_ROWS.includes(row)) {
        expect([item.id, item.metal]).toEqual([item.id, undefined]);
      } else {
        expect([item.id, item.metal]).toEqual([item.id, SRD_CONTENT.item(row)?.metal]);
      }
    }
    expect(SRD_CONTENT.item('longsword-plus-1')?.metal).toBe(true);
    expect(SRD_CONTENT.item('mithral-chain-mail')?.metal).toBe(true);
    expect(SRD_CONTENT.item('staff-of-power')?.metal).toBeUndefined();
  });
});

describe('the metal mark on substances', () => {
  it('says of every row of the Object Armor Class table whether it is a metal', () => {
    expect(
      Object.fromEntries(SRD_OBJECT_MATERIALS.map((row) => [row.id, row.metal])),
    ).toEqual({
      cloth: false,
      crystal: false,
      wood: false,
      stone: false,
      iron: true,
      mithral: true,
      adamantine: true,
    });
  });
});
